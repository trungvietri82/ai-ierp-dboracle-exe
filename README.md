# AI iERP — desktop (exe) client

The **installable desktop client** ("claude desktop"-style) of the AI iERP platform.
Built from the Electron app and adapted to log in to the shared backend, use the
server-managed models + the user's granted MCP servers, and share chat history —
while still running file/shell tools **locally** on the user's machine.

## The 3 repos
| Repo | Vai trò |
|---|---|
| **ai-ierp-dboracle** | Backend (Node + Fastify + **Oracle**) + **web app** (claude.ai-style) |
| **ai-ierp-dboracle-exe** (this) | **Desktop / exe** client of the platform — connects to the backend |
| **ai-ierp** | The original standalone desktop app (self-contained, no shared backend) |

```
   ai-ierp-dboracle (backend + Oracle)
        ▲                    ▲
        │ HTTP + WebSocket   │ (auth: Bearer token / ?token)
   web (browser)        THIS REPO — desktop exe
                         • chat + MCP via backend
                         • file/shell tools run locally
```

## How it connects (phương án A)
The backend holds the AI provider keys and connects to MCP, so the desktop streams
chat turns **from the backend**. `desktop-bridge/shared-backend.mjs` is the client
the Electron main process uses (token login → `getModels` / `getMcpServers` /
`chat` over WebSocket). Verified end-to-end against the backend.

## Status / remaining work
Seeded from the desktop Electron app. Remaining (Mảng 4 — desktop UI integration):
1. **Login gate** in the renderer → `SharedBackend.login()`, store the token.
2. Replace the local provider/model + MCP config with `getModels()` / `getMcpServers()`
   from the backend (server-managed keys; user only picks a model).
3. Route chat through `SharedBackend.chat()` (history shared with web via Oracle).
4. **Bidirectional local tools**: let the backend agent ask this desktop to run a
   *local* file/shell tool, then continue the turn — the desktop's unique capability.

## Build
Same Electron / electron-builder pipeline as the base app (produces the Windows exe
installer). See `package.json` scripts and `electron-builder.yml`.
