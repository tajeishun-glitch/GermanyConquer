# GermanyConquer — Team `//CodeBreaker` AI War Room & Hackathon Starter

Pre-competition **AI Team War Room Portal** + **Zero-Conflict Hackathon Repository** for **Team `//CodeBreaker`** (Gamuda Berhad 2-Day Hackathon).

- **GitHub Repository**: https://github.com/tajeishun-glitch/GermanyConquer

---

## 👥 Team `//CodeBreaker` Squad Roster

| # | Name | Callsign | Email | Module Ownership | Git Push Verified |
| :- | :--- | :--- | :--- | :--- | :--- |
| 1 | **Wesley Phoon** | **`CodeKeeper`** | `tkphoon@gamuda.com.my` | TBD (`frontend` / `backend` / `ai-engine`) | `[x]` Verified |
| 2 | **Ta Jei Shun** | **`CodeJSON`** | `tajeishun@gamuda.com.my` | TBD (`frontend` / `backend` / `ai-engine`) | `[ ]` Pending |
| 3 | **Chong Shaw Zhe** | **`CodeZero`** | `chongshawzhe@gamuda.com.my` | TBD (`frontend` / `backend` / `ai-engine`) | `[ ]` Pending |

> **GitHub Collaborator Access**: In `https://github.com/tajeishun-glitch/GermanyConquer/settings/access`, click **Add people** to invite Wesley (`CodeKeeper`) and Shaw Zhe (`CodeZero`) as Collaborators so all 3 teammates can push branches and merge PRs.

---

## 🚀 Quick Start — Run on Any Teammate's Laptop

```bash
git clone https://github.com/tajeishun-glitch/GermanyConquer.git
cd GermanyConquer
npm install
npm start
```

Then open **http://localhost:8000** in your browser!

### Built-In Features
- **💬 Live Message Board (`#general`, `#idea-lab`, `#tech-git`, `#standup`)**: Real-time SSE chat, `@ai` embedded AI copilot, `✨ AI Summarize`, `Ctrl+V` screenshot paste, pinned banners, and emoji reactions.
- **📎 Multimodal AI File Scanner**: Drag-and-drop any PDF, photo, screenshot, CSV/Excel, Word/PPT, or code file (up to 25 MB) — scans with **Gemini 3.8 Flash** (`@google/genai`) and generates 3 tailored Gamuda hackathon ideas + 3-person task splits.
- **💡 Idea Pitch & Voting Lab**: Vote (`0/3` to `3/3`), comment, auto-draft pitches, and click **🎤 3-Min Pitch & Score** for a timed 3-speaker stage script + judge rubric score out of 100.
- **📋 3-Person Sprint Board & Synced 48h Countdown**: Track tasks across `frontend/`, `backend/`, `ai-engine/`, and `shared/`, plus export the entire war room to Markdown (`📥 Export`).

---

## 📂 Repository Structure (Zero Merge-Conflict Layout)

```text
GermanyConquer/
├── frontend/          # Person 1: UI, Dashboard, Demo UX (index.html, styles.css, app.js)
├── backend/           # Person 2: Node HTTP + SSE API Server & Smoke Tests (server.mjs)
├── ai-engine/         # Person 3: Gemini 3.8 Flash Multimodal & Pitch Coach (brainstorm.mjs)
├── shared/            # Locked API contract + seed data (api_contract.json, mock_data.json)
├── AGENTS.md          # Shared Antigravity rules auto-loaded for all 3 teammates
├── Dockerfile         # 1-command Cloud Run container config
└── package.json       # npm start / npm run dev / npm test
```
