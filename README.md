# Campus Dorm Marketplace

- **Frontend:** `frontend/` — single `index.html` + `styles.css` + `app.js` (vanilla JS + Bootstrap)
- **Backend API (full app + Heroku):** `API/FullstackWithLlm.Api/` — ASP.NET Core Web API (C#), MySQL via raw SQL
- **Backend (lightweight skeleton):** `backend/` — small ASP.NET Core app that static-files `../frontend` and exposes `GET /api/health` (run with `dotnet run` from `backend/`; uses port 5078 per `launchSettings.json`)
- **DB scripts:** `database/` (e.g. `marketplace_schema.sql`, `catchup_api_schema_idempotent.sql`)

## Local run

1. Create `.env` in the **repo root** (copy from `.env.example`) with `DATABASE_URL` and `Jwt__SigningKey` (32+ characters).
2. From the repo root:
   - `dotnet run --project API/FullstackWithLlm.Api/FullstackWithLlm.Api.csproj`
3. Open **http://localhost:5147** (HTTP — same process serves the SPA and the API; check the terminal for the exact URLs, including **5148** if listed).
4. Smoke test: `GET http://localhost:5147/api/health` → `{ "status": "ok" }`

**If the page won’t load:** the full app is **not** the mini project in `backend/` (port **5078**). For the marketplace, always run the command in step 2 and use **http://localhost:5147** — not `https://` unless you have configured HTTPS, and not port 5078 alone (that shell only has `/api/health` unless the real API is also running on 5147).

## Heroku

Use the `Procfile` in the repo root. Set Config Vars: `DATABASE_URL` (JawsDB), `Jwt__SigningKey`, etc. — see `.env.example`.
