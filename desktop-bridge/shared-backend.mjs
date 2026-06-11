/**
 * Shared-backend client for the DESKTOP app (Electron main process).
 *
 * Phương án A: the backend holds the AI provider keys and connects to MCP, so
 * the desktop streams chat turns FROM the backend (LLM + MCP run server-side).
 * Local file/shell tools still run on the user's machine (wired in a later step).
 *
 * Auth is token-based (the desktop is not a browser): login returns a token used
 * as `Authorization: Bearer <token>` for REST and `?token=<token>` for the WS.
 * Uses Node's global fetch + WebSocket (Node 18+/22+), so no extra deps.
 */
export class SharedBackend {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = null;
    this.user = null;
  }

  async login(username, password) {
    const r = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password, appKind: 'desktop' }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `login failed (${r.status})`);
    this.token = d.token;
    this.user = d.user;
    return d.user;
  }

  async _get(path) {
    const r = await fetch(`${this.baseUrl}${path}`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `GET ${path} failed (${r.status})`);
    return d;
  }

  getModels() {
    return this._get('/api/me/models').then((d) => d.models);
  }
  getMcpServers() {
    return this._get('/api/me/mcp-servers').then((d) => d.servers);
  }
  getConversations() {
    return this._get('/api/conversations').then((d) => d.conversations);
  }
  getMessages(id) {
    return this._get(`/api/conversations/${id}/messages`).then((d) => d.messages);
  }

  /**
   * Stream a chat turn from the backend. `onEvent({type, ...})` receives
   * conversation/start/delta/tool_call/tool_result/warning/done/error events.
   * Resolves with the final 'done' event.
   */
  chat({ text, modelId, conversationId }, onEvent) {
    return new Promise((resolve, reject) => {
      const wsUrl = `${this.baseUrl.replace(/^http/, 'ws')}/ws/chat?token=${encodeURIComponent(this.token)}`;
      const ws = new WebSocket(wsUrl);
      ws.addEventListener('open', () =>
        ws.send(JSON.stringify({ type: 'chat', text, modelId, conversationId: conversationId || undefined }))
      );
      ws.addEventListener('message', (e) => {
        const m = JSON.parse(e.data);
        onEvent?.(m);
        if (m.type === 'done') {
          ws.close();
          resolve(m);
        } else if (m.type === 'error') {
          ws.close();
          reject(new Error(m.error));
        }
      });
      ws.addEventListener('error', () => reject(new Error('websocket error')));
    });
  }
}
