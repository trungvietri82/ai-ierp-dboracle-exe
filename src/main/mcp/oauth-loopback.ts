/**
 * @module main/mcp/oauth-loopback
 *
 * A temporary localhost HTTP server used to capture the OAuth 2.1 authorization
 * code redirect for desktop (loopback) clients. Since Open Cowork is not a web
 * app, it registers a redirect URI like http://127.0.0.1:<port>/callback; after
 * the user logs in (and passes OTP) in their browser, the authorization server
 * redirects here with `?code=...&state=...`, which we hand back to the caller.
 */
import http from 'http';
import { AddressInfo } from 'net';
import { log, logWarn } from '../utils/logger';

const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"><title>AI iERP</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{text-align:center;max-width:420px;padding:32px}.ok{font-size:48px;margin-bottom:12px}
h1{font-size:20px;margin:0 0 8px}p{color:#94a3b8;margin:0}</style></head>
<body><div class="card"><div class="ok">&#10003;</div>
<h1>Xác thực thành công</h1>
<p>Bạn có thể đóng tab này và quay lại AI iERP.</p></div></body></html>`;

const ERROR_HTML = (msg: string): string => `<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"><title>AI iERP</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{text-align:center;max-width:420px;padding:32px}.err{font-size:48px;margin-bottom:12px;color:#f87171}
h1{font-size:20px;margin:0 0 8px}p{color:#94a3b8;margin:0}</style></head>
<body><div class="card"><div class="err">&#10007;</div>
<h1>Xác thực thất bại</h1><p>${msg}</p></div></body></html>`;

export interface LoopbackServer {
  /** The chosen loopback port. */
  port: number;
  /** Full redirect URI to register with the authorization server. */
  redirectUri: string;
  /**
   * Resolve once the browser redirects back with an authorization code.
   * Rejects on timeout, an OAuth error param, or a state mismatch (CSRF).
   */
  waitForCode(opts: { timeoutMs: number; expectedState?: string }): Promise<string>;
  /** Abort an in-flight wait (e.g. the user closed the auth window). */
  cancel(err: Error): void;
  /** Close the loopback server. */
  close(): void;
}

/**
 * Start a loopback HTTP server on a free 127.0.0.1 port and return helpers to
 * await the OAuth authorization-code callback.
 */
export async function startLoopbackServer(callbackPath = '/callback'): Promise<LoopbackServer> {
  let resolveCode: ((code: string) => void) | null = null;
  let rejectCode: ((err: Error) => void) | null = null;
  let received = false;

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname !== callbackPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state') || undefined;

      if (error) {
        const desc = url.searchParams.get('error_description') || error;
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(ERROR_HTML(desc));
        received = true;
        rejectCode?.(new Error(`OAuth error: ${desc}`));
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(ERROR_HTML('Thiếu mã uỷ quyền (code).'));
        return;
      }

      // CSRF protection: the returned state must match the one we generated.
      (server as unknown as { __pendingState?: string }).__pendingState = state;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(SUCCESS_HTML);
      received = true;
      resolveCode?.(code);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal error');
      rejectCode?.(err instanceof Error ? err : new Error(String(err)));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const { port } = server.address() as AddressInfo;
  const redirectUri = `http://127.0.0.1:${port}${callbackPath}`;
  log(`[OAuth] Loopback server listening on ${redirectUri}`);

  const close = (): void => {
    try {
      server.close();
    } catch (err) {
      logWarn(`[OAuth] Error closing loopback server: ${String(err)}`);
    }
  };

  const waitForCode = ({
    timeoutMs,
    expectedState,
  }: {
    timeoutMs: number;
    expectedState?: string;
  }): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!received) {
          reject(new Error('Hết thời gian chờ xác thực (timeout).'));
        }
      }, timeoutMs);

      resolveCode = (code: string) => {
        clearTimeout(timer);
        const returnedState = (server as unknown as { __pendingState?: string }).__pendingState;
        if (expectedState && returnedState && returnedState !== expectedState) {
          reject(new Error('State không khớp (nghi ngờ CSRF).'));
          return;
        }
        resolve(code);
      };
      rejectCode = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };
    });

  const cancel = (err: Error): void => {
    if (!received) {
      rejectCode?.(err);
    }
  };

  return { port, redirectUri, waitForCode, cancel, close };
}
