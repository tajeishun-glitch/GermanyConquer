import assert from "node:assert/strict";
import { createPortalServer } from "./server.mjs";

const server = await createPortalServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

try {
  // 1. Health check & Gemini 3.8 model string
  const health = await fetch(`${base}/api/health`).then((r) => r.json());
  assert.equal(health.status, "ok");
  assert.equal(health.aiModel, "gemini-3.8-flash");

  // 2. Frontend index.html serves //CodeBreaker War Room
  const htmlRes = await fetch(`${base}/`);
  assert.equal(htmlRes.status, 200);
  const html = await htmlRes.text();
  assert.ok(html.includes("//CodeBreaker"));
  assert.ok(html.includes("AI File Scanner"));

  // 3. Upload & AI-scan an attachment (CSV dataset) + clean up
  const sampleCsv =
    "Site_Zone,Open_Safety_Alerts,Delay_Hours\nTunnel_Sector_A,4,6.5\nStation_Box_B,9,14.0\n";
  const uploadRes = await fetch(`${base}/api/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      originalName: "gamuda_site_log.csv",
      mimeType: "text/csv",
      dataBase64: Buffer.from(sampleCsv, "utf8").toString("base64"),
      uploadedBy: "m1",
      autoAnalyze: true,
      userPrompt: "Spot delay bottlenecks",
    }),
  }).then((r) => r.json());

  assert.equal(uploadRes.status, "ok");
  assert.ok(uploadRes.file.analysis);
  assert.equal(uploadRes.file.analysis.generatedIdeas.length, 3);

  const rawFetch = await fetch(`${base}/api/files/${uploadRes.file.id}/raw`);
  assert.equal(rawFetch.status, 200);

  await fetch(`${base}/api/files/${uploadRes.file.id}`, { method: "DELETE" });

  // 4. @AI Chat Copilot & Summarizer
  const aiChat = await fetch(`${base}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channelId: "general",
      question: "Give us a quick status check",
    }),
  }).then((r) => r.json());
  assert.equal(aiChat.status, "ok");
  assert.equal(aiChat.message.authorId, "ai");
  await fetch(`${base}/api/messages/${aiChat.message.id}`, { method: "DELETE" });

  // 5. 3-Minute Winning Pitch & Judge Rubric endpoint
  const state = await fetch(`${base}/api/state`).then((r) => r.json());
  const firstIdeaId = state.ideas[0].id;
  const pitchRes = await fetch(`${base}/api/ideas/${firstIdeaId}/pitch`, {
    method: "POST",
  }).then((r) => r.json());
  assert.equal(pitchRes.status, "ok");
  assert.ok(pitchRes.pitchDeck.scores.total > 0);
  assert.equal(pitchRes.pitchDeck.pitchScript.length, 3);

  // 6. Markdown War Room Export
  const mdRes = await fetch(`${base}/api/export.md`);
  assert.equal(mdRes.status, 200);
  const mdText = await mdRes.text();
  assert.ok(mdText.includes("//CodeBreaker"));

  console.log("✅ All //CodeBreaker AI & Attachment Scanner tests passed!");
} finally {
  server.close();
}
