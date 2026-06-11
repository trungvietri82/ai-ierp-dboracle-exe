# AI iERP — desktop (exe) client

The installable **desktop client** of the AI iERP platform ("claude desktop"-style):
an Electron app that loads the platform **web app from the backend** and adds
**local** (on-machine) file/shell capability.

## The 3 repos
| Repo | Vai trò |
|---|---|
| **ai-ierp-dboracle** | Backend (Node + Fastify + **Oracle**) + web app (served at one origin) |
| **ai-ierp-dboracle-exe** (this) | **Desktop / exe** client — Electron shell that loads the backend |
| **ai-ierp** | Original standalone desktop app (self-contained, no shared backend) |

## How it works
- On first run, a **setup screen** asks for the backend URL (default `http://localhost:8080`);
  it's saved in `userData/config.json`. Change it anytime via menu **AI iERP → Cấu hình server…**
  or the `AIIERP_BACKEND` env var.
- The window then loads the backend's web app (login + chat + admin). Chat + MCP run
  on the backend (server-managed keys); history is shared with the browser web app.
- `src/preload.js` exposes `window.aiierp.localTools` (readFile / writeFile / listDir /
  exec) — the desktop's **local capability**, available to the web app when it detects
  it's running in the desktop. (Wiring these into the backend agent loop — so the model
  can run a *local* tool — is the next step.)

## Layout
- `src/main.js` — Electron main (window, backend URL config, local-tool IPC).
- `src/preload.js` — `window.aiierp` bridge. `src/setup.html` — backend URL screen.
- `scripts/after-pack.js` + `embed-win-icon.js` — embed the iERP icon into the exe
  (no code-signing cert, so `signAndEditExecutable: false`).
- `desktop-bridge/shared-backend.mjs` — token-auth client (for future main-process use).
- `electron-builder.yml` — Windows NSIS config.

## Build
```bash
npm install
npm start                 # run the app (dev)
npm run build             # -> release/AI iERP-<version>-setup.exe  (iERP icon)
```
Verified: the shell loads the backend web app; the NSIS installer builds (82 MB) with
the iERP icon embedded.
