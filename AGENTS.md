# AGENTS.md — Base44 dev environment notes

## What this app is
"Ça va mal finir" — a real-time multiplayer card game (Cards Against Humanity style) in the browser. French-language UI. Mobile-first, PWA-capable.

## Stack
- **Server**: Node.js + Express (static + REST) + Socket.IO (realtime game state). Single process, no build step.
- **DB**: SQLite via the native `node:sqlite` module (requires Node ≥ 22). Emits an ExperimentalWarning on boot — harmless.
- **Frontend**: Vanilla HTML/CSS/JS, no framework, no bundler. Files in `public/` are served as-is. Screen system in `public/js/screens.js`.
- **Push**: `web-push` (VAPID). Optional — app boots fine without keys.

## Running here
- `docker compose -f docker-compose.base44.yml up -d` — single `app` service on port 3000.
- Source is bind-mounted at `/app`; the SQLite DB lives at `data/app.db` (gitignored) and persists via the bind mount.
- No live-reload dev server. Frontend changes (public/) appear on browser refresh (served with `no-store`). Server changes need `docker compose restart app` then `reload_preview`.
- `npm install --omit=dev` runs at container start, then `node server.js`.

## Credentials
- **No external secrets required.** Admin credentials auto-generate on first boot and persist in the committed `.env`. VAPID keys are already in `.env`.
- Admin panel at `/admin.html` — email/password printed in container logs on startup.

## Health check
- `GET /health` → `{"ok":true,...}`
- `GET /api/packs` → card pack metadata (confirms JSON packs loaded).

## Gotchas
- Do NOT mount a named volume over `data/` — it hides the committed card-pack JSON files (packs show "0 carte"). The bind mount already persists the DB.
- The app sets strict CSP headers; external resources are limited to Google Fonts and jsDelivr.
- `node:sqlite` is experimental in Node 22 — works without flags, just prints a warning.
