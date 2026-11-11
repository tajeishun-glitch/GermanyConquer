import http from "node:http";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  sharpenHackathonIdea,
  analyzeUploadedAttachment,
  askTeamAiCopilot,
  generatePitchAndCritique,
  isGeminiConfigured,
  getActiveModel,
} from "../ai-engine/brainstorm.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const FRONTEND_DIR = path.join(ROOT_DIR, "frontend");
const SEED_PATH = path.join(ROOT_DIR, "shared", "mock_data.json");
const ENV_PATH = path.join(ROOT_DIR, ".env");
const DATA_DIR = path.join(__dirname, "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const STORE_PATH = path.join(DATA_DIR, "portal_store.json");

const PORT = Number(process.env.PORT || process.env.BACKEND_PORT || 8000);
const MAX_JSON_BYTES = 36 * 1024 * 1024; // Supports ~25MB base64 attachments

/** @type {Map<string, { res: http.ServerResponse, memberId: string }>} */
const sseClients = new Map();

let state = null;
let writeChain = Promise.resolve();

async function loadEnvFileIfPresent() {
  for (const candidate of [ENV_PATH, path.join(os.homedir(), ".env")]) {
    if (!existsSync(candidate)) continue;
    try {
      const content = await fs.readFile(candidate, "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const k = trimmed.slice(0, eqIdx).trim();
        const v = trimmed
          .slice(eqIdx + 1)
          .trim()
          .replace(/^['"]|['"]$/g, "");
        if (k && !process.env[k]) {
          process.env[k] = v;
        }
      }
    } catch {
      // Ignore unreadable env file
    }
  }
}

async function loadState() {
  await loadEnvFileIfPresent();
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  if (existsSync(STORE_PATH)) {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    state = JSON.parse(raw);
    state.files = state.files || [];
    state.timer = state.timer || {
      mode: "warmup",
      label: "Pre-Hackathon Warmup",
      endsAt: null,
    };
    return;
  }
  const seedRaw = await fs.readFile(SEED_PATH, "utf8");
  state = JSON.parse(seedRaw);
  state.files = state.files || [];
  await saveState();
}

function saveState() {
  const snapshot = JSON.stringify(state, null, 2);
  writeChain = writeChain
    .then(() => fs.writeFile(STORE_PATH, snapshot, "utf8"))
    .catch((err) => console.error("Failed saving portal_store.json:", err));
  return writeChain;
}

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const urls = [];
  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      if (net.family === "IPv4" && !net.internal) {
        urls.push(`http://${net.address}:${PORT}`);
      }
    }
  }
  return urls;
}

function getOnlineMemberIds() {
  const ids = new Set();
  for (const client of sseClients.values()) {
    if (client.memberId) ids.add(client.memberId);
  }
  return Array.from(ids);
}

function buildFullPayload() {
  return {
    ...state,
    presence: {
      onlineMemberIds: getOnlineMemberIds(),
      connectedTabs: sseClients.size,
    },
    serverInfo: {
      port: PORT,
      lanUrls: getLanAddresses(),
      aiConfigured: isGeminiConfigured(),
      aiModel: getActiveModel(),
    },
  };
}

function broadcast(eventType = "state_updated", extra = {}) {
  const payload = JSON.stringify({
    type: eventType,
    timestamp: new Date().toISOString(),
    state: buildFullPayload(),
    ...extra,
  });
  for (const [clientId, client] of sseClients.entries()) {
    try {
      client.res.write(`data: ${payload}\n\n`);
    } catch {
      sseClients.delete(clientId);
    }
  }
}

function sendJson(res, statusCode, body) {
  const data = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(data);
}

async function readJsonBody(req, maxBytes = MAX_JSON_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("Upload exceeds maximum size (25MB)");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".ico": "image/x-icon",
};

function sanitizeFilename(name) {
  return String(name || "attachment")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 100);
}

function makeInitials(name) {
  const parts = String(name || "")
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "TM";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function getMemberName(id) {
  if (id === "ai") return "//CodeBreaker AI";
  return state.members.find((m) => m.id === id)?.name || id;
}

async function triggerChannelAiReply({ channelId, question }) {
  const channelMsgs = state.messages
    .filter((m) => m.channelId === channelId)
    .slice(-15)
    .map((m) => ({
      ...m,
      authorName: getMemberName(m.authorId),
    }));

  const aiResult = await askTeamAiCopilot({
    question,
    channelName: channelId,
    recentMessages: channelMsgs,
    ideas: state.ideas,
    tasks: state.tasks,
  });

  const aiMsg = {
    id: `msg-${crypto.randomUUID().slice(0, 8)}`,
    channelId,
    authorId: "ai",
    text: aiResult.reply,
    tag: "ai",
    aiMode: aiResult.mode,
    pinned: false,
    reactions: { "🤖": [] },
    createdAt: new Date().toISOString(),
  };
  state.messages.push(aiMsg);
  await saveState();
  broadcast("message_created", { messageId: aiMsg.id });
  return aiMsg;
}

function generateMarkdownExport() {
  const lines = [
    `# ${state.teamName || "//CodeBreaker"} — Gamuda Hackathon War Room Brief`,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `## 1. Squad Roster`,
    ...state.members.map(
      (m) => `- **${m.name}** (\`${m.handle}\`) — *${m.role}* [${m.status}]`
    ),
    ``,
    `## 2. Ranked Hackathon Ideas`,
  ];

  const sortedIdeas = [...state.ideas].sort(
    (a, b) => (b.votes?.length || 0) - (a.votes?.length || 0)
  );
  for (const idea of sortedIdeas) {
    lines.push(
      `### ${idea.title} (${idea.votes?.length || 0}/3 Squad Votes)`,
      `- **Problem**: ${idea.problem}`,
      `- **48h MVP Solution**: ${idea.solution}`,
      `- **Gamuda Impact**: ${idea.gamudaImpact}`,
      `- **Tags**: ${(idea.tags || []).join(", ")}`,
      ``
    );
  }

  if (state.files?.length > 0) {
    lines.push(`## 3. Uploaded Attachments & AI Scans`);
    for (const f of state.files) {
      lines.push(`- **${f.originalName}** (${Math.round(f.sizeBytes / 1024)} KB)`);
      if (f.analysis?.summary) {
        lines.push(`  - *AI Summary*: ${f.analysis.summary}`);
      }
    }
    lines.push(``);
  }

  lines.push(`## 4. Sprint Board Tasks`);
  for (const status of ["doing", "todo", "done"]) {
    lines.push(`### ${status.toUpperCase()}`);
    const list = state.tasks.filter((t) => t.status === status);
    if (list.length === 0) lines.push(`- *(None)*`);
    for (const t of list) {
      lines.push(
        `- [${t.status === "done" ? "x" : " "}] (${t.module}/) ${
          t.title
        } — *${getMemberName(t.ownerId)}*`
      );
    }
    lines.push(``);
  }

  return lines.join("\n");
}

async function serveFrontend(reqUrl, res) {
  const pathname = reqUrl.pathname === "/" ? "/index.html" : reqUrl.pathname;
  const resolved = path.resolve(FRONTEND_DIR, "." + pathname);
  if (!resolved.startsWith(FRONTEND_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) throw new Error("Not a file");
    const ext = path.extname(resolved).toLowerCase();
    const content = await fs.readFile(resolved);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(content);
  } catch {
    const indexFile = path.join(FRONTEND_DIR, "index.html");
    const content = await fs.readFile(indexFile);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end(content);
  }
}

export async function createPortalServer() {
  await loadState();

  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    const reqUrl = new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`
    );
    const { pathname } = reqUrl;

    try {
      // 1. Health Check
      if (req.method === "GET" && pathname === "/api/health") {
        sendJson(res, 200, {
          status: "ok",
          service: "codebreaker-portal",
          ...buildFullPayload().serverInfo,
          connectedTabs: sseClients.size,
        });
        return;
      }

      // 2. Real-time Server-Sent Events (SSE)
      if (req.method === "GET" && pathname === "/api/events") {
        const memberId = reqUrl.searchParams.get("memberId") || "m1";
        const clientId = crypto.randomUUID();

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });

        sseClients.set(clientId, { res, memberId });
        res.write(
          `data: ${JSON.stringify({
            type: "connected",
            clientId,
            state: buildFullPayload(),
          })}\n\n`
        );

        broadcast("presence_changed");

        const heartbeat = setInterval(() => {
          try {
            res.write(": ping\n\n");
          } catch {
            clearInterval(heartbeat);
          }
        }, 20000);

        req.on("close", () => {
          clearInterval(heartbeat);
          sseClients.delete(clientId);
          broadcast("presence_changed");
        });
        return;
      }

      // 3. Full State
      if (req.method === "GET" && pathname === "/api/state") {
        sendJson(res, 200, buildFullPayload());
        return;
      }

      // 4. Export Markdown Brief
      if (req.method === "GET" && pathname === "/api/export.md") {
        const md = generateMarkdownExport();
        res.writeHead(200, {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="codebreaker-warroom-brief.md"',
        });
        res.end(md);
        return;
      }

      // 5. Save Local Gemini API Key (writes to gitignored .env, never echoed back)
      if (req.method === "POST" && pathname === "/api/settings/ai-key") {
        const body = await readJsonBody(req, 32_000);
        const apiKey = String(body.apiKey || "").trim();
        if (!apiKey) {
          sendJson(res, 400, { error: "API key cannot be empty" });
          return;
        }
        process.env.GEMINI_API_KEY = apiKey;
        process.env.USE_MOCK_DATA = "false";

        // Persist safely in local gitignored .env
        let envLines = [];
        if (existsSync(ENV_PATH)) {
          const existing = await fs.readFile(ENV_PATH, "utf8");
          envLines = existing
            .split(/\r?\n/)
            .filter(
              (l) =>
                !l.trim().startsWith("GEMINI_API_KEY=") &&
                !l.trim().startsWith("GEMINI_MODEL=")
            );
        }
        envLines.push(`GEMINI_API_KEY=${apiKey}`);
        envLines.push(`GEMINI_MODEL=${getActiveModel()}`);
        await fs.writeFile(
          ENV_PATH,
          envLines.filter(Boolean).join("\n") + "\n",
          "utf8"
        );

        broadcast("ai_status_changed");
        sendJson(res, 200, {
          status: "ok",
          aiConfigured: isGeminiConfigured(),
          aiModel: getActiveModel(),
        });
        return;
      }

      // 6. Synced 48-Hour Hackathon Countdown Timer
      if (req.method === "POST" && pathname === "/api/timer") {
        const body = await readJsonBody(req, 32_000);
        if (body.action === "start48h") {
          const hours = Number(body.hours) || 48;
          state.timer = {
            mode: "running",
            label: body.label || "48h Hackathon Live",
            endsAt: new Date(Date.now() + hours * 3600 * 1000).toISOString(),
          };
        } else if (body.action === "custom" && body.endsAt) {
          state.timer = {
            mode: "running",
            label: body.label || "Submission Deadline",
            endsAt: new Date(body.endsAt).toISOString(),
          };
        } else {
          state.timer = {
            mode: "warmup",
            label: "Pre-Hackathon Warmup",
            endsAt: null,
          };
        }
        await saveState();
        broadcast("timer_updated");
        sendJson(res, 200, { status: "ok", timer: state.timer });
        return;
      }

      // 7. Upload Attachment + Optional Instant AI Multimodal Scan
      if (req.method === "POST" && pathname === "/api/files") {
        const body = await readJsonBody(req);
        const originalName = String(body.originalName || "attachment").trim();
        const mimeType = String(
          body.mimeType || "application/octet-stream"
        ).trim();
        const rawBase64 = String(body.dataBase64 || "").replace(
          /^data:[^;]+;base64,/,
          ""
        );
        if (!rawBase64) {
          sendJson(res, 400, { error: "Missing file content (dataBase64)" });
          return;
        }

        const buffer = Buffer.from(rawBase64, "base64");
        const fileId = `file-${crypto.randomUUID().slice(0, 8)}`;
        const storedName = `${fileId}-${sanitizeFilename(originalName)}`;
        const diskPath = path.join(UPLOADS_DIR, storedName);
        await fs.writeFile(diskPath, buffer);

        const fileMeta = {
          id: fileId,
          originalName,
          storedName,
          mimeType,
          sizeBytes: buffer.length,
          uploadedBy: body.uploadedBy || "m1",
          createdAt: new Date().toISOString(),
          analysis: null,
        };

        if (body.autoAnalyze !== false) {
          fileMeta.analysis = await analyzeUploadedAttachment({
            fileMeta,
            fileBuffer: buffer,
            userPrompt: body.userPrompt || "",
          });
        }

        state.files.unshift(fileMeta);

        // Optional post into chat channel
        if (body.postToChannel) {
          state.messages.push({
            id: `msg-${crypto.randomUUID().slice(0, 8)}`,
            channelId: body.channelId || "general",
            authorId: fileMeta.uploadedBy,
            text:
              body.messageText ||
              `📎 Uploaded "${originalName}"${
                fileMeta.analysis
                  ? ` — AI Scan generated ${
                      fileMeta.analysis.generatedIdeas?.length || 0
                    } hackathon ideas!`
                  : ""
              }`,
            tag: "snippet",
            attachmentId: fileMeta.id,
            pinned: false,
            reactions: {},
            createdAt: new Date().toISOString(),
          });
        }

        await saveState();
        broadcast("file_uploaded", { fileId: fileMeta.id });
        sendJson(res, 201, { status: "ok", file: fileMeta });
        return;
      }

      // 8. Serve Raw Uploaded Attachment (Inline preview / download)
      const rawFileMatch = pathname.match(/^\/api\/files\/([^/]+)\/raw$/);
      if (req.method === "GET" && rawFileMatch) {
        const fileId = decodeURIComponent(rawFileMatch[1]);
        const fileMeta = state.files.find((f) => f.id === fileId);
        if (!fileMeta) {
          sendJson(res, 404, { error: "Attachment not found" });
          return;
        }
        const diskPath = path.join(UPLOADS_DIR, fileMeta.storedName);
        if (!existsSync(diskPath)) {
          sendJson(res, 404, { error: "Attachment missing on disk" });
          return;
        }
        const buf = await fs.readFile(diskPath);
        const isInline =
          fileMeta.mimeType.startsWith("image/") ||
          fileMeta.mimeType === "application/pdf" ||
          fileMeta.mimeType.startsWith("text/");
        res.writeHead(200, {
          "Content-Type": fileMeta.mimeType || "application/octet-stream",
          "Content-Disposition": `${
            isInline ? "inline" : "attachment"
          }; filename="${sanitizeFilename(fileMeta.originalName)}"`,
        });
        res.end(buf);
        return;
      }

      // 9. Run / Re-run AI Scan on Uploaded Attachment
      const analyzeFileMatch = pathname.match(
        /^\/api\/files\/([^/]+)\/analyze$/
      );
      if (req.method === "POST" && analyzeFileMatch) {
        const fileId = decodeURIComponent(analyzeFileMatch[1]);
        const fileMeta = state.files.find((f) => f.id === fileId);
        if (!fileMeta) {
          sendJson(res, 404, { error: "Attachment not found" });
          return;
        }
        const diskPath = path.join(UPLOADS_DIR, fileMeta.storedName);
        const buffer = await fs.readFile(diskPath);
        const body = await readJsonBody(req, 32_000);
        fileMeta.analysis = await analyzeUploadedAttachment({
          fileMeta,
          fileBuffer: buffer,
          userPrompt: body.userPrompt || "",
        });
        await saveState();
        broadcast("file_analyzed", { fileId });
        sendJson(res, 200, { status: "ok", file: fileMeta });
        return;
      }

      // 10. Delete Uploaded Attachment
      const delFileMatch = pathname.match(/^\/api\/files\/([^/]+)$/);
      if (req.method === "DELETE" && delFileMatch) {
        const fileId = decodeURIComponent(delFileMatch[1]);
        const fileMeta = state.files.find((f) => f.id === fileId);
        if (fileMeta) {
          const diskPath = path.join(UPLOADS_DIR, fileMeta.storedName);
          await fs.rm(diskPath, { force: true }).catch(() => {});
        }
        state.files = state.files.filter((f) => f.id !== fileId);
        await saveState();
        broadcast("file_deleted", { fileId });
        sendJson(res, 200, { status: "ok" });
        return;
      }

      // 11. Update Member Profile
      const memberMatch = pathname.match(/^\/api\/members\/([^/]+)$/);
      if (req.method === "PUT" && memberMatch) {
        const memberId = decodeURIComponent(memberMatch[1]);
        const member = state.members.find((m) => m.id === memberId);
        if (!member) {
          sendJson(res, 404, { error: "Member not found" });
          return;
        }
        const body = await readJsonBody(req, 32_000);
        if (typeof body.name === "string" && body.name.trim()) {
          member.name = body.name.trim().slice(0, 40);
          member.initials = makeInitials(member.name);
        }
        if (typeof body.handle === "string" && body.handle.trim()) {
          member.handle = body.handle.trim().slice(0, 60);
        }
        if (typeof body.role === "string" && body.role.trim()) {
          member.role = body.role.trim().slice(0, 40);
        }
        if (typeof body.status === "string" && body.status.trim()) {
          member.status = body.status.trim().slice(0, 40);
        }
        await saveState();
        broadcast("member_updated", { memberId });
        sendJson(res, 200, { status: "ok", member });
        return;
      }

      // 12. Post Chat Message (auto-triggers @ai if mentioned!)
      if (req.method === "POST" && pathname === "/api/messages") {
        const body = await readJsonBody(req, 64_000);
        const text = String(body.text || "").trim();
        if (!text && !body.attachmentId) {
          sendJson(res, 400, { error: "Message text is required" });
          return;
        }
        const channelId = body.channelId || "general";
        const msg = {
          id: `msg-${crypto.randomUUID().slice(0, 8)}`,
          channelId,
          authorId: body.authorId || "m1",
          text: text.slice(0, 3000),
          tag: ["chat", "announcement", "blocker", "snippet", "ai"].includes(
            body.tag
          )
            ? body.tag
            : "chat",
          attachmentId: body.attachmentId || null,
          pinned: Boolean(body.pinned),
          reactions: {},
          createdAt: new Date().toISOString(),
        };
        state.messages.push(msg);
        await saveState();
        broadcast("message_created", { messageId: msg.id });

        // If message mentions @ai, run AI Copilot asynchronously!
        if (/(^|\s)@ai\b/i.test(text)) {
          const cleanQuestion = text.replace(/@ai\b/gi, "").trim();
          triggerChannelAiReply({
            channelId,
            question: cleanQuestion,
          }).catch((err) => console.error("@ai trigger error:", err));
        }

        sendJson(res, 201, { status: "ok", message: msg });
        return;
      }

      // 13. Direct @AI Channel Copilot / Summarizer Endpoint
      if (req.method === "POST" && pathname === "/api/ai/chat") {
        const body = await readJsonBody(req, 32_000);
        const aiMsg = await triggerChannelAiReply({
          channelId: body.channelId || "general",
          question: body.question || "",
        });
        sendJson(res, 200, { status: "ok", message: aiMsg });
        return;
      }

      // 14. Toggle Emoji Reaction on Message
      const reactMatch = pathname.match(/^\/api\/messages\/([^/]+)\/react$/);
      if (req.method === "POST" && reactMatch) {
        const msgId = decodeURIComponent(reactMatch[1]);
        const msg = state.messages.find((m) => m.id === msgId);
        if (!msg) {
          sendJson(res, 404, { error: "Message not found" });
          return;
        }
        const body = await readJsonBody(req, 16_000);
        const emoji = String(body.emoji || "👍").slice(0, 8);
        const memberId = String(body.memberId || "m1");
        msg.reactions = msg.reactions || {};
        const list = msg.reactions[emoji] || [];
        if (list.includes(memberId)) {
          msg.reactions[emoji] = list.filter((id) => id !== memberId);
          if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
        } else {
          msg.reactions[emoji] = [...list, memberId];
        }
        await saveState();
        broadcast("message_reacted", { messageId: msgId });
        sendJson(res, 200, { status: "ok", message: msg });
        return;
      }

      // 15. Toggle Pin on Message
      const pinMatch = pathname.match(/^\/api\/messages\/([^/]+)\/pin$/);
      if (req.method === "POST" && pinMatch) {
        const msgId = decodeURIComponent(pinMatch[1]);
        const msg = state.messages.find((m) => m.id === msgId);
        if (!msg) {
          sendJson(res, 404, { error: "Message not found" });
          return;
        }
        msg.pinned = !msg.pinned;
        await saveState();
        broadcast("message_pinned", { messageId: msgId });
        sendJson(res, 200, { status: "ok", message: msg });
        return;
      }

      // 16. Delete Message
      const deleteMsgMatch = pathname.match(/^\/api\/messages\/([^/]+)$/);
      if (req.method === "DELETE" && deleteMsgMatch) {
        const msgId = decodeURIComponent(deleteMsgMatch[1]);
        state.messages = state.messages.filter((m) => m.id !== msgId);
        await saveState();
        broadcast("message_deleted", { messageId: msgId });
        sendJson(res, 200, { status: "ok" });
        return;
      }

      // 17. Create Hackathon Idea Pitch
      if (req.method === "POST" && pathname === "/api/ideas") {
        const body = await readJsonBody(req, 64_000);
        const title = String(body.title || "").trim();
        if (!title) {
          sendJson(res, 400, { error: "Idea title is required" });
          return;
        }
        const authorId = body.authorId || "m1";
        const idea = {
          id: `idea-${crypto.randomUUID().slice(0, 8)}`,
          authorId,
          title: title.slice(0, 160),
          problem: String(body.problem || "").trim().slice(0, 1200),
          solution: String(body.solution || "").trim().slice(0, 1200),
          gamudaImpact: String(body.gamudaImpact || "").trim().slice(0, 600),
          tags: Array.isArray(body.tags)
            ? body.tags
                .map((t) => String(t).trim())
                .filter(Boolean)
                .slice(0, 6)
            : [],
          sourceFileName: body.sourceFileName || null,
          votes: [authorId],
          comments: [],
          pitchDeck: null,
          createdAt: new Date().toISOString(),
        };
        state.ideas.unshift(idea);

        state.messages.push({
          id: `msg-${crypto.randomUUID().slice(0, 8)}`,
          channelId: "idea-lab",
          authorId,
          text: `💡 Added new hackathon idea: "${idea.title}"${
            idea.sourceFileName ? ` (scanned from 📎 ${idea.sourceFileName})` : ""
          } — vote & generate a 3-min pitch in Idea Lab!`,
          tag: "announcement",
          pinned: false,
          reactions: { "💡": [authorId] },
          createdAt: new Date().toISOString(),
        });

        await saveState();
        broadcast("idea_created", { ideaId: idea.id });
        sendJson(res, 201, { status: "ok", idea });
        return;
      }

      // 18. Generate 3-Minute Winning Pitch & Judge Critique for an Idea
      const pitchMatch = pathname.match(/^\/api\/ideas\/([^/]+)\/pitch$/);
      if (req.method === "POST" && pitchMatch) {
        const ideaId = decodeURIComponent(pitchMatch[1]);
        const idea = state.ideas.find((i) => i.id === ideaId);
        if (!idea) {
          sendJson(res, 404, { error: "Idea not found" });
          return;
        }
        idea.pitchDeck = await generatePitchAndCritique({ idea });
        await saveState();
        broadcast("idea_pitch_generated", { ideaId });
        sendJson(res, 200, { status: "ok", pitchDeck: idea.pitchDeck });
        return;
      }

      // 19. Toggle Vote on Idea
      const voteMatch = pathname.match(/^\/api\/ideas\/([^/]+)\/vote$/);
      if (req.method === "POST" && voteMatch) {
        const ideaId = decodeURIComponent(voteMatch[1]);
        const idea = state.ideas.find((i) => i.id === ideaId);
        if (!idea) {
          sendJson(res, 404, { error: "Idea not found" });
          return;
        }
        const body = await readJsonBody(req, 16_000);
        const memberId = String(body.memberId || "m1");
        idea.votes = idea.votes || [];
        if (idea.votes.includes(memberId)) {
          idea.votes = idea.votes.filter((id) => id !== memberId);
        } else {
          idea.votes.push(memberId);
        }
        await saveState();
        broadcast("idea_voted", { ideaId });
        sendJson(res, 200, { status: "ok", idea });
        return;
      }

      // 20. Comment on Idea
      const commentMatch = pathname.match(/^\/api\/ideas\/([^/]+)\/comment$/);
      if (req.method === "POST" && commentMatch) {
        const ideaId = decodeURIComponent(commentMatch[1]);
        const idea = state.ideas.find((i) => i.id === ideaId);
        if (!idea) {
          sendJson(res, 404, { error: "Idea not found" });
          return;
        }
        const body = await readJsonBody(req, 32_000);
        const text = String(body.text || "").trim();
        if (!text) {
          sendJson(res, 400, { error: "Comment text is required" });
          return;
        }
        const comment = {
          id: `c-${crypto.randomUUID().slice(0, 8)}`,
          authorId: body.authorId || "m1",
          text: text.slice(0, 600),
          createdAt: new Date().toISOString(),
        };
        idea.comments = idea.comments || [];
        idea.comments.push(comment);
        await saveState();
        broadcast("idea_commented", { ideaId });
        sendJson(res, 201, { status: "ok", comment });
        return;
      }

      // 21. Delete Idea
      const delIdeaMatch = pathname.match(/^\/api\/ideas\/([^/]+)$/);
      if (req.method === "DELETE" && delIdeaMatch) {
        const ideaId = decodeURIComponent(delIdeaMatch[1]);
        state.ideas = state.ideas.filter((i) => i.id !== ideaId);
        await saveState();
        broadcast("idea_deleted", { ideaId });
        sendJson(res, 200, { status: "ok" });
        return;
      }

      // 22. Create Sprint Task
      if (req.method === "POST" && pathname === "/api/tasks") {
        const body = await readJsonBody(req, 32_000);
        const title = String(body.title || "").trim();
        if (!title) {
          sendJson(res, 400, { error: "Task title is required" });
          return;
        }
        const task = {
          id: `task-${crypto.randomUUID().slice(0, 8)}`,
          title: title.slice(0, 220),
          ownerId: body.ownerId || "m1",
          module: ["frontend", "backend", "ai-engine", "shared"].includes(
            body.module
          )
            ? body.module
            : "shared",
          status: ["todo", "doing", "done"].includes(body.status)
            ? body.status
            : "todo",
          createdAt: new Date().toISOString(),
        };
        state.tasks.push(task);
        await saveState();
        broadcast("task_created", { taskId: task.id });
        sendJson(res, 201, { status: "ok", task });
        return;
      }

      // 23. Update / Delete Sprint Task
      const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (taskMatch && req.method === "PATCH") {
        const taskId = decodeURIComponent(taskMatch[1]);
        const task = state.tasks.find((t) => t.id === taskId);
        if (!task) {
          sendJson(res, 404, { error: "Task not found" });
          return;
        }
        const body = await readJsonBody(req, 32_000);
        if (["todo", "doing", "done"].includes(body.status)) {
          task.status = body.status;
        }
        if (body.ownerId) task.ownerId = String(body.ownerId);
        if (typeof body.title === "string" && body.title.trim()) {
          task.title = body.title.trim().slice(0, 220);
        }
        if (
          ["frontend", "backend", "ai-engine", "shared"].includes(body.module)
        ) {
          task.module = body.module;
        }
        await saveState();
        broadcast("task_updated", { taskId });
        sendJson(res, 200, { status: "ok", task });
        return;
      }

      if (taskMatch && req.method === "DELETE") {
        const taskId = decodeURIComponent(taskMatch[1]);
        state.tasks = state.tasks.filter((t) => t.id !== taskId);
        await saveState();
        broadcast("task_deleted", { taskId });
        sendJson(res, 200, { status: "ok" });
        return;
      }

      // 24. AI Engine — Sharpen Idea Pitch
      if (req.method === "POST" && pathname === "/api/ai/brainstorm") {
        const body = await readJsonBody(req, 32_000);
        const result = await sharpenHackathonIdea({
          topic: body.topic,
          roughNotes: body.roughNotes,
        });
        sendJson(res, 200, result);
        return;
      }

      // 25. Static Frontend
      if (req.method === "GET") {
        await serveFrontend(reqUrl, res);
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      console.error("Portal request error:", err);
      sendJson(res, 500, { error: err.message || "Internal server error" });
    }
  });

  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const server = await createPortalServer();
  server.listen(PORT, "0.0.0.0", () => {
    const lanUrls = getLanAddresses();
    console.log("\n========================================================");
    console.log("  🚀 //CodeBreaker — Gamuda Hackathon AI War Room Live!");
    console.log("========================================================");
    console.log(`  Local URL : http://localhost:${PORT}`);
    for (const url of lanUrls) {
      console.log(`  Team LAN  : ${url}  (share on same Wi-Fi/VPN)`);
    }
    console.log(
      `  AI Engine : ${
        isGeminiConfigured()
          ? `✨ Gemini Live (${getActiveModel()})`
          : "🧠 Smart Local Mode (click 🔑 AI Key in UI to enable Gemini 3.8 Flash)"
      }`
    );
    console.log("========================================================\n");
  });
}
