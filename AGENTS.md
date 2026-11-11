# //CodeBreaker — Shared Antigravity Agent Rules

This repository (`GermanyConquer`) is used by **Team `//CodeBreaker`** — a 3-person Gamuda Berhad Hackathon squad (`CodeKeeper`, `CodeJSON`, `CodeZero`) — over a 48-hour sprint. Follow these workspace rules at all times so code generated across all three teammates' machines integrates cleanly without merge conflicts.

## Squad Roster
- **Wesley Phoon (`CodeKeeper`)** — `tkphoon@gamuda.com.my`
- **Ta Jei Shun (`CodeJSON`)** — `tajeishun@gamuda.com.my`
- **Chong Shaw Zhe (`CodeZero`)** — `chongshawzhe@gamuda.com.my`

## 1. Strict Directory Ownership (Anti-Conflict Boundary)

Each teammate owns one top-level module. Unless explicitly instructed by the user, restrict file edits to the module you are working on:

- `frontend/`: UI components, dashboards, charts/maps, and demo presentation flow.
- `backend/`: HTTP API server, database/storage adapters, authentication, and cloud deployment configs.
- `ai-engine/`: Gemini prompts, structured output schemas, RAG/agent logic, and evaluation scripts.
- `shared/`: Single source of truth for API request/response contracts (`api_contract.json`) and fallback demo payloads (`mock_data.json`).

## 2. Contract-First Integration

- Before changing an API request or response field in `backend/` or `ai-engine/`, update `shared/api_contract.json` and `shared/mock_data.json` first so `frontend/` stays synchronized.
- Keep field names consistent (`snake_case` or `camelCase` matching `shared/api_contract.json`).

## 3. Demo Reliability & Fallback Mode

- Every external AI or cloud call should fail gracefully.
- Respect the `USE_MOCK_DATA=true` environment flag so the application can serve deterministic payloads from `shared/mock_data.json` during offline testing or stage Wi-Fi disruptions.

## 4. Credentials & Git Hygiene

- Never hardcode API keys, tokens, or GCP service account JSON contents in source files.
- Always read secrets from environment variables and document any newly required variable in `.env.example`.
- Keep `main` runnable at all times; prefer small, frequent feature branches (`feat/<scope>`).
