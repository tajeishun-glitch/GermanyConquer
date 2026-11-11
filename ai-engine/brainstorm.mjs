/**
 * //CodeBreaker AI Engine (ai-engine/brainstorm.mjs)
 * Powered by @google/genai Interactions API with gemini-3.8-flash.
 * Includes multimodal attachment scanning (PDF, images, CSV/XLSX, docs, audio, code),
 * @AI team chat copilot, 3-minute stage pitch generator, judge rubric scorer,
 * and smart local content extraction fallback when GEMINI_API_KEY is not yet set.
 */

// Lazy-loaded @google/genai so server starts even before npm install

const DEFAULT_MODEL = "gemini-3.8-flash";

const DOCUMENT_MIMES = new Set([
  "application/pdf",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

export function getActiveModel() {
  const envModel = (process.env.GEMINI_MODEL || "").trim();
  // Upgrade any deprecated 1.5/2.0/2.5 model names automatically to gemini-3.8-flash
  if (!envModel || /^gemini-(1\.5|2\.0|2\.5)/.test(envModel)) {
    return DEFAULT_MODEL;
  }
  return envModel;
}

export function isGeminiConfigured() {
  const key = (process.env.GEMINI_API_KEY || "").trim();
  return (
    process.env.USE_MOCK_DATA !== "true" &&
    Boolean(key) &&
    key !== "your_gemini_api_key_here"
  );
}

async function getClient() {
  const { GoogleGenAI } = await import("@google/genai");
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  return new GoogleGenAI({ apiKey });
}

function extractInteractionText(interaction) {
  if (typeof interaction?.output_text === "string" && interaction.output_text) {
    return interaction.output_text;
  }
  const steps = interaction?.steps || [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step?.type === "model_output" && Array.isArray(step.content)) {
      const texts = step.content
        .filter((c) => c?.type === "text" && typeof c.text === "string")
        .map((c) => c.text);
      if (texts.length > 0) return texts.join("");
    }
  }
  return "";
}

/**
 * Extracts readable text or structural hints locally from any file buffer
 * for text-based files and for offline smart-fallback inspection.
 */
function inspectBufferLocally(fileMeta, buffer) {
  const mime = (fileMeta.mimeType || "").toLowerCase();
  const ext = (fileMeta.originalName || "")
    .split(".")
    .pop()
    ?.toLowerCase() || "";
  const sizeKb = Math.max(1, Math.round(buffer.length / 1024));

  const isTextLike =
    mime.startsWith("text/") ||
    [
      "txt",
      "md",
      "json",
      "csv",
      "tsv",
      "js",
      "mjs",
      "ts",
      "py",
      "sql",
      "html",
      "xml",
      "yaml",
      "yml",
      "log",
    ].includes(ext);

  if (isTextLike) {
    const rawText = buffer.toString("utf8").slice(0, 24000);
    const lines = rawText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const previewLines = lines.slice(0, 8).map((l) => l.trim().slice(0, 140));
    return {
      isTextLike: true,
      rawText,
      lineCount: lines.length,
      previewLines,
      summaryHint: `Text/Data file (${sizeKb} KB, ${lines.length} non-empty lines)`,
    };
  }

  // Image dimensions check (PNG / JPEG)
  if (mime.startsWith("image/")) {
    let dims = "";
    if (
      buffer.length > 24 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      const w = buffer.readUInt32BE(16);
      const h = buffer.readUInt32BE(20);
      dims = `, ${w}x${h}px`;
    }
    return {
      isTextLike: false,
      rawText: "",
      lineCount: 0,
      previewLines: [],
      summaryHint: `Image attachment (${mime}${dims}, ${sizeKb} KB)`,
    };
  }

  // Extract printable ASCII phrases from PDFs / Office binaries as hints
  const asciiMatches =
    buffer
      .subarray(0, 65536)
      .toString("latin1")
      .match(/[A-Za-z][A-Za-z0-9 ,.:;_/-]{12,90}/g) || [];
  const cleanSnippets = asciiMatches
    .filter(
      (s) =>
        !/obj|endobj|stream|endstream|xml|rels|Content_Types|FlateDecode/i.test(
          s
        )
    )
    .slice(0, 6)
    .map((s) => s.trim());

  return {
    isTextLike: false,
    rawText: cleanSnippets.join("\n"),
    lineCount: cleanSnippets.length,
    previewLines: cleanSnippets,
    summaryHint: `Binary document (${mime || ext || "file"}, ${sizeKb} KB)`,
  };
}

/**
 * 1. Pitch Sharpener (Idea Modal)
 */
export async function sharpenHackathonIdea({ topic = "", roughNotes = "" }) {
  const cleanTopic = topic.trim() || "Smart Engineering Workflow Assistant";
  const cleanNotes = roughNotes.trim();

  if (isGeminiConfigured()) {
    try {
      const client = await getClient();
      const interaction = await client.interactions.create({
        model: getActiveModel(),
        system_instruction:
          "You are the elite AI hackathon coach for Team //CodeBreaker (Wesley 'CodeKeeper', Ta Jei Shun 'CodeJSON', Chong Shaw Zhe 'CodeZero') competing in Gamuda Berhad's 48-hour hackathon. Craft crisp, practical, high-ROI engineering, construction, infrastructure, property, or smart-operations pitches.",
        input: `Turn this rough concept into a winning 48-hour hackathon pitch for Gamuda Berhad.
Topic: ${cleanTopic}
Rough Notes: ${cleanNotes || "None provided"}`,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              problem: { type: "string" },
              solution: { type: "string" },
              gamudaImpact: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              suggestedTasks: { type: "array", items: { type: "string" } },
            },
            required: [
              "title",
              "problem",
              "solution",
              "gamudaImpact",
              "tags",
              "suggestedTasks",
            ],
          },
        },
      });

      const parsed = JSON.parse(extractInteractionText(interaction));
      return {
        mode: "gemini",
        model: getActiveModel(),
        title: parsed.title || cleanTopic,
        problem: parsed.problem || "",
        solution: parsed.solution || "",
        gamudaImpact: parsed.gamudaImpact || "",
        tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5) : ["Gemini 3.8", "Gamuda"],
        suggestedTasks: Array.isArray(parsed.suggestedTasks)
          ? parsed.suggestedTasks.slice(0, 3)
          : [],
      };
    } catch (err) {
      console.warn("Gemini sharpenHackathonIdea fallback:", err.message);
    }
  }

  const summaryContext = cleanNotes
    ? ` (${cleanNotes.slice(0, 110)}${cleanNotes.length > 110 ? "..." : ""})`
    : "";

  return {
    mode: "smart-fallback",
    model: "local-coach",
    title: `${cleanTopic} â€” Gamuda Operations Copilot`,
    problem: `Project teams face fragmented site data and manual review bottlenecks around ${cleanTopic.toLowerCase()}${summaryContext}, slowing down critical daily engineering decisions.`,
    solution: `An interactive multimodal dashboard built by //CodeBreaker where teams upload field inputs or documents and instantly receive structured risk flags, visual KPIs, and recommended actions.`,
    gamudaImpact: `Cuts manual review turnaround by ~70% while improving auditability and safety/commercial accuracy across Gamuda packages.`,
    tags: ["Gemini 3.8", "Gamuda Ops", "48h MVP"],
    suggestedTasks: [
      `[CodeKeeper] Build interactive split-screen demo UI & ROI KPI cards for "${cleanTopic}"`,
      `[CodeJSON] Build backend API endpoint + seed 3 realistic Gamuda sample scenarios`,
      `[CodeZero] Build Gemini 3.8 structured output prompt & attachment scanner for "${cleanTopic}"`,
    ],
  };
}

/**
 * 2. Multimodal Attachment Scanner & Hackathon Idea Generator
 */
export async function analyzeUploadedAttachment({
  fileMeta,
  fileBuffer,
  userPrompt = "",
}) {
  const localInfo = inspectBufferLocally(fileMeta, fileBuffer);
  const mime = (fileMeta.mimeType || "application/octet-stream").toLowerCase();
  const focusNote = userPrompt.trim()
    ? `\nTeam's specific question/focus: ${userPrompt.trim()}`
    : "";

  if (isGeminiConfigured()) {
    try {
      const client = await getClient();
      const inputBlocks = [];

      if (mime.startsWith("image/")) {
        inputBlocks.push({
          type: "image",
          data: fileBuffer.toString("base64"),
          mime_type: mime,
        });
      } else if (DOCUMENT_MIMES.has(mime)) {
        inputBlocks.push({
          type: "document",
          data: fileBuffer.toString("base64"),
          mime_type: mime,
        });
      } else if (mime.startsWith("audio/")) {
        inputBlocks.push({
          type: "audio",
          data: fileBuffer.toString("base64"),
          mime_type: mime,
        });
      } else if (mime.startsWith("video/")) {
        inputBlocks.push({
          type: "video",
          data: fileBuffer.toString("base64"),
          mime_type: mime,
        });
      } else if (localInfo.rawText) {
        inputBlocks.push({
          type: "text",
          text: `Uploaded File Content (${fileMeta.originalName}):\n\`\`\`\n${localInfo.rawText.slice(
            0,
            20000
          )}\n\`\`\``,
        });
      }

      inputBlocks.push({
        type: "text",
        text: `Analyze this uploaded attachment ("${fileMeta.originalName}", ${localInfo.summaryHint}) for Team //CodeBreaker (CodeKeeper, CodeJSON, CodeZero) preparing for Gamuda Berhad's 2-day Hackathon.${focusNote}

Provide:
1. "summary": Clear 2-3 sentence summary of what this file contains or shows.
2. "keyFindings": 3 to 5 specific insights, pain points, requirements, metrics, or opportunities spotted in the file.
3. "generatedIdeas": 3 distinct, high-impact 48-hour hackathon project ideas inspired by this file for Gamuda Berhad (each with title, problem, solution, gamudaImpact, tags).
4. "squadPlan": 3 concrete action items tailored for CodeKeeper (Platform/Integration), CodeJSON (Backend/Data), and CodeZero (UX/AI).`,
      });

      const interaction = await client.interactions.create({
        model: getActiveModel(),
        system_instruction:
          "You are Team //CodeBreaker's Multimodal Document & Visual Analyst for the Gamuda Berhad Hackathon. Extract concrete details from uploaded files and propose realistic, judge-winning 48-hour prototypes.",
        input: inputBlocks,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: {
            type: "object",
            properties: {
              summary: { type: "string" },
              keyFindings: { type: "array", items: { type: "string" } },
              generatedIdeas: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    problem: { type: "string" },
                    solution: { type: "string" },
                    gamudaImpact: { type: "string" },
                    tags: { type: "array", items: { type: "string" } },
                  },
                  required: [
                    "title",
                    "problem",
                    "solution",
                    "gamudaImpact",
                    "tags",
                  ],
                },
              },
              squadPlan: { type: "array", items: { type: "string" } },
            },
            required: [
              "summary",
              "keyFindings",
              "generatedIdeas",
              "squadPlan",
            ],
          },
        },
      });

      const parsed = JSON.parse(extractInteractionText(interaction));
      return {
        mode: "gemini",
        model: getActiveModel(),
        analyzedAt: new Date().toISOString(),
        summary: parsed.summary || "",
        keyFindings: parsed.keyFindings || [],
        generatedIdeas: parsed.generatedIdeas || [],
        squadPlan: parsed.squadPlan || [],
      };
    } catch (err) {
      console.warn("Gemini analyzeUploadedAttachment fallback:", err.message);
    }
  }

  // Smart Local File Scanner (extracts real snippets/headers when no Gemini key yet)
  const baseTitle = (fileMeta.originalName || "Attachment")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();

  const findings = [
    `Detected ${localInfo.summaryHint} uploaded as "${fileMeta.originalName}".`,
  ];
  if (localInfo.previewLines.length > 0) {
    findings.push(
      `Extracted content preview: "${localInfo.previewLines[0].slice(0, 120)}"`
    );
    if (localInfo.previewLines[1]) {
      findings.push(
        `Secondary structure/header: "${localInfo.previewLines[1].slice(0, 120)}"`
      );
    }
  } else {
    findings.push(
      `Ready for deep visual/PDF multimodal scanning â€” add GEMINI_API_KEY via the topbar ðŸ”‘ AI Key button to unlock full Gemini 3.8 Flash vision & document understanding.`
    );
  }
  if (userPrompt.trim()) {
    findings.push(`Focused analysis around team prompt: "${userPrompt.trim()}"`);
  }

  return {
    mode: "smart-fallback",
    model: "local-scanner",
    analyzedAt: new Date().toISOString(),
    summary: `Scanned "${fileMeta.originalName}" (${localInfo.summaryHint}). ${
      localInfo.isTextLike
        ? `Parsed ${localInfo.lineCount} lines of text/structured data to synthesize hackathon opportunities.`
        : `Captured attachment metadata and structural signals. Connect your Gemini API key (ðŸ”‘ button) anytime to re-scan with live Gemini 3.8 Flash multimodal vision.`
    }`,
    keyFindings: findings,
    generatedIdeas: [
      {
        title: `${baseTitle} Intelligence Copilot`,
        problem: `Engineers and project coordinators manually inspect files like "${fileMeta.originalName}", risking missed anomalies and slow cross-team handovers.`,
        solution: `Drag-and-drop ${
          mime.startsWith("image/") ? "visual inspection" : "document & data"
        } analyzer that extracts structured risk items, anomalies, and instant action summaries.`,
        gamudaImpact: `Reduces review time per submission from 45 minutes to under 15 seconds with standardized audit trails.`,
        tags: ["Multimodal AI", "Document Scan", "Gamuda Ops"],
      },
      {
        title: `Auto-Compliance & KPI Tracker for ${baseTitle}`,
        problem: `Critical metrics buried inside attachments rarely trigger real-time alerts until weekly progress meetings.`,
        solution: `Automated ingestion pipeline that benchmarks uploaded files against Gamuda project targets and flags red/amber variances on a live dashboard.`,
        gamudaImpact: `Prevents costly rework and schedule slips by catching specification or progress deviations on Day 1.`,
        tags: ["KPI Radar", "Compliance", "Cloud Run"],
      },
      {
        title: `Ask-the-Site Knowledge Hub (${baseTitle})`,
        problem: `New team members struggle to query historical site records, drawings, and tabular logs quickly on mobile or desktop.`,
        solution: `Conversational Q&A portal with grounded citations back to exact rows, pages, or image regions of uploaded project files.`,
        gamudaImpact: `Saves 5+ hours/week per engineer searching across project folders and handovers.`,
        tags: ["Grounded Q&A", "Knowledge Base", "48h MVP"],
      },
    ],
    squadPlan: [
      `[CodeKeeper] Wire "${fileMeta.originalName}" as a 1-click demo sample scenario with clear Before/After KPI cards`,
      `[CodeJSON] Expose structured JSON parsing & validation pipeline for ${mime} uploads`,
      `[CodeZero] Tune Gemini 3.8 Flash multimodal schema & confidence scoring on "${fileMeta.originalName}"`,
    ],
  };
}

/**
 * 3. @AI Team Chat Copilot & Channel Summarizer
 */
export async function askTeamAiCopilot({
  question = "",
  channelName = "general",
  recentMessages = [],
  ideas = [],
  tasks = [],
}) {
  const chatTranscript = recentMessages
    .slice(-15)
    .map((m) => `[${m.authorName}] (${m.tag}): ${m.text}`)
    .join("\n");

  const ideaSummary = ideas
    .slice(0, 5)
    .map((i) => `- "${i.title}" (${i.votes?.length || 0}/3 votes): ${i.solution}`)
    .join("\n");

  const openTasks = tasks
    .filter((t) => t.status !== "done")
    .slice(0, 8)
    .map((t) => `- [${t.status}] (${t.module}/) ${t.title}`)
    .join("\n");

  if (isGeminiConfigured()) {
    try {
      const client = await getClient();
      const interaction = await client.interactions.create({
        model: getActiveModel(),
        system_instruction:
          "You are //CodeBreaker AI, the embedded 4th teammate for Wesley (CodeKeeper), Ta Jei Shun (CodeJSON), and Chong Shaw Zhe (CodeZero) in Gamuda Berhad's 48-hour Hackathon. Keep answers concise, punchy, practical, and formatted cleanly with bullet points.",
        input: `Channel: #${channelName}
Recent Team Messages:
${chatTranscript || "(No messages yet)"}

Current Squad Ideas:
${ideaSummary || "(None yet)"}

Open Sprint Tasks:
${openTasks || "(None yet)"}

Teammate Request: ${question || "Summarize our current discussion, highlight blockers, and suggest our next 3 priorities."}`,
      });

      const reply = extractInteractionText(interaction).trim();
      if (reply) {
        return { mode: "gemini", model: getActiveModel(), reply };
      }
    } catch (err) {
      console.warn("Gemini askTeamAiCopilot fallback:", err.message);
    }
  }

  // Smart Contextual Fallback using actual portal state!
  const topIdea = [...ideas].sort(
    (a, b) => (b.votes?.length || 0) - (a.votes?.length || 0)
  )[0];
  const blockers = recentMessages.filter((m) => m.tag === "blocker");
  const todoCount = tasks.filter((t) => t.status === "todo").length;
  const doingCount = tasks.filter((t) => t.status === "doing").length;

  const lines = [
    `ðŸ¤– **//CodeBreaker AI Sync (#${channelName})**`,
    question
      ? `> Prompt: *"${question.slice(0, 120)}"*`
      : `> Channel Snapshot & Next Actions`,
    `- **Leading Idea**: ${
      topIdea
        ? `"${topIdea.title}" (${topIdea.votes?.length || 0}/3 squad votes)`
        : "No ideas voted yet â€” head to Idea Lab!"
    }`,
    `- **Sprint Pulse**: ${doingCount} in progress, ${todoCount} queued in To Do.`,
  ];

  if (blockers.length > 0) {
    lines.push(
      `- **Active Blocker Spotted**: ${blockers[blockers.length - 1].text.slice(
        0,
        140
      )}`
    );
  }
  lines.push(
    `- **Recommended Next Move**: Lock your top-voted idea in Idea Lab, upload any hackathon brief/sample dataset in **ðŸ“Ž AI File Scanner**, and assign 1 task each to \`CodeKeeper\`, \`CodeJSON\`, and \`CodeZero\`.`
  );
  lines.push(
    `*(Tip: Click **ðŸ”‘ AI Key** in the top bar to connect \`GEMINI_API_KEY\` for live Gemini 3.8 Flash deep reasoning!)*`
  );

  return {
    mode: "smart-fallback",
    model: "local-copilot",
    reply: lines.join("\n"),
  };
}

/**
 * 4. 3-Minute Winning Stage Pitch + Judge Rubric Critique
 */
export async function generatePitchAndCritique({ idea }) {
  if (isGeminiConfigured()) {
    try {
      const client = await getClient();
      const interaction = await client.interactions.create({
        model: getActiveModel(),
        system_instruction:
          "You are a Gamuda Berhad Executive Hackathon Judge and Pitch Coach for Team //CodeBreaker (CodeKeeper = Wesley Phoon, CodeJSON = Ta Jei Shun, CodeZero = Chong Shaw Zhe).",
        input: `Evaluate this hackathon idea and write a timed 3-minute winning stage pitch split across all 3 teammates:
Title: ${idea.title}
Problem: ${idea.problem}
48h MVP Solution: ${idea.solution}
Gamuda Impact: ${idea.gamudaImpact}
Tags: ${(idea.tags || []).join(", ")}`,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: {
            type: "object",
            properties: {
              scores: {
                type: "object",
                properties: {
                  gamudaImpact: { type: "number" },
                  innovation: { type: "number" },
                  feasibility48h: { type: "number" },
                  demoWow: { type: "number" },
                  total: { type: "number" },
                },
                required: [
                  "gamudaImpact",
                  "innovation",
                  "feasibility48h",
                  "demoWow",
                  "total",
                ],
              },
              verdict: { type: "string" },
              blindSpots: { type: "array", items: { type: "string" } },
              pitchScript: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    speaker: { type: "string" },
                    timeWindow: { type: "string" },
                    talkingPoints: { type: "string" },
                  },
                  required: ["speaker", "timeWindow", "talkingPoints"],
                },
              },
              judgeQA: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    question: { type: "string" },
                    winningAnswer: { type: "string" },
                  },
                  required: ["question", "winningAnswer"],
                },
              },
            },
            required: [
              "scores",
              "verdict",
              "blindSpots",
              "pitchScript",
              "judgeQA",
            ],
          },
        },
      });

      const parsed = JSON.parse(extractInteractionText(interaction));
      return {
        mode: "gemini",
        model: getActiveModel(),
        ...parsed,
      };
    } catch (err) {
      console.warn("Gemini generatePitchAndCritique fallback:", err.message);
    }
  }

  return {
    mode: "smart-fallback",
    model: "local-judge",
    scores: {
      gamudaImpact: 23,
      innovation: 21,
      feasibility48h: 22,
      demoWow: 22,
      total: 88,
    },
    verdict: `Strong enterprise fit for Gamuda! To push "${idea.title}" from 88/100 to 95+, open your demo with a real anonymized Gamuda document/photo and display a live ROI counter on screen.`,
    blindSpots: [
      "Show how false positives are handled (human-in-the-loop approval button).",
      "Prepare 1 offline fallback sample in case stage Wi-Fi lags during the live demo.",
    ],
    pitchScript: [
      {
        speaker: "CodeKeeper (Wesley)",
        timeWindow: "0:00 â€“ 0:50 Â· The Hook & Pain Point",
        talkingPoints: `Open with a relatable Gamuda site/project scenario: "${
          idea.problem || "Manual workflows cost hours every week."
        }" Show the 'Before' pain in 15 seconds, then introduce Team //CodeBreaker's solution: ${idea.title}.`,
      },
      {
        speaker: "CodeJSON (Jei Shun)",
        timeWindow: "0:50 â€“ 2:00 Â· Live End-to-End Demo",
        talkingPoints: `Run the live product (no slides!). Upload a realistic input and walk judges through: "${
          idea.solution || "Instant structured analysis and action workflow."
        }" Point out speed, reliability, and clean architecture.`,
      },
      {
        speaker: "CodeZero (Shaw Zhe)",
        timeWindow: "2:00 â€“ 3:00 Â· AI Architecture, ROI & Rollout",
        talkingPoints: `Highlight Gemini 3.8 multimodal accuracy, human-in-the-loop safety, and measurable business ROI: "${
          idea.gamudaImpact || "Significant hours saved across project packages."
        }" Close with how Gamuda can pilot this next Monday.`,
      },
    ],
    judgeQA: [
      {
        question: "How do you prevent AI hallucinations on critical engineering/commercial data?",
        winningAnswer:
          "Every AI output includes source citations/confidence scores and acts as a decision copilot with 1-click engineer verification rather than blind automation.",
      },
      {
        question: "Can this scale across existing Gamuda systems after the 48-hour hackathon?",
        winningAnswer:
          "Yes â€” it is containerized for Cloud Run with a clean JSON contract (`shared/api_contract.json`), making integration with SharePoint, BIM exports, or BigQuery straightforward.",
      },
    ],
  };
}
