/**
 * @module main/mcp/oauth-provider
 *
 * An OAuthClientProvider implementation for Electron desktop, used to connect
 * Open Cowork to OAuth 2.1-protected MCP servers (e.g. the PC1 MCP server).
 *
 * Flow ("authenticate once at assignment time"):
 * 1. The user clicks "Authenticate" on an MCP server. We run this provider in
 *    INTERACTIVE mode with a temporary loopback redirect URI.
 * 2. The SDK transport sees a 401, runs dynamic client registration (RFC 7591),
 *    generates a PKCE pair, and calls `redirectToAuthorization` — we open the
 *    system browser to the authorization endpoint (APEX login + OTP for PC1).
 * 3. The loopback server captures the `?code=...` redirect; we call
 *    `transport.finishAuth(code)` which exchanges it for access/refresh tokens.
 * 4. Tokens are persisted. Future connections (NON-INTERACTIVE mode) attach the
 *    access token and silently refresh it — no further prompts.
 *
 * In NON-INTERACTIVE mode (normal background connect), `redirectToAuthorization`
 * does NOT open a browser; it throws `NeedsInteractiveAuthError` so the UI can
 * surface a "needs authentication" state instead of popping a browser
 * unexpectedly (e.g. when a refresh token has expired).
 */
import type {
  OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthTokens,
  OAuthClientMetadata,
  OAuthClientInformation,
  OAuthClientInformationFull,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { shell } from 'electron';
import { randomUUID } from 'crypto';
import { oauthTokenStore } from './oauth-token-store';
import { log, logWarn } from '../utils/logger';

/** Thrown in non-interactive mode when the server requires a fresh login. */
export class NeedsInteractiveAuthError extends Error {
  constructor(public readonly serverId: string) {
    super(`MCP server ${serverId} requires interactive authentication`);
    this.name = 'NeedsInteractiveAuthError';
  }
}

const CLIENT_NAME = 'AI iERP';

export interface OAuthProviderOptions {
  serverId: string;
  /** Loopback redirect URI, e.g. http://127.0.0.1:43117/callback. */
  redirectUri: string;
  /** When true, redirectToAuthorization opens the system browser. */
  interactive: boolean;
  /** OAuth scope to request, if the server needs an explicit one. */
  scope?: string;
  /** Called with the authorization URL right before the browser opens. */
  onRedirect?: (url: URL) => void;
}

export class ElectronOAuthClientProvider implements OAuthClientProvider {
  private readonly serverId: string;
  private readonly _redirectUri: string;
  private readonly interactive: boolean;
  private readonly scope?: string;
  private readonly onRedirect?: (url: URL) => void;
  /** CSRF state for the in-flight authorization; verified by the loopback. */
  private _state?: string;

  constructor(opts: OAuthProviderOptions) {
    this.serverId = opts.serverId;
    this._redirectUri = opts.redirectUri;
    this.interactive = opts.interactive;
    this.scope = opts.scope;
    this.onRedirect = opts.onRedirect;
  }

  get redirectUrl(): string {
    return this._redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: CLIENT_NAME,
      redirect_uris: [this._redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(this.scope ? { scope: this.scope } : {}),
    };
  }

  /** Random CSRF state; cached so the loopback can verify the callback. */
  state(): string {
    if (!this._state) {
      this._state = randomUUID();
    }
    return this._state;
  }

  /** The state value generated for the current authorization (if any). */
  get expectedState(): string | undefined {
    return this._state;
  }

  clientInformation(): OAuthClientInformation | OAuthClientInformationFull | undefined {
    return oauthTokenStore.getClientInformation(this.serverId);
  }

  saveClientInformation(info: OAuthClientInformationFull): void {
    oauthTokenStore.saveClientInformation(this.serverId, info);
  }

  tokens(): OAuthTokens | undefined {
    return oauthTokenStore.getTokens(this.serverId);
  }

  saveTokens(tokens: OAuthTokens): void {
    oauthTokenStore.saveTokens(this.serverId, tokens);
  }

  saveCodeVerifier(codeVerifier: string): void {
    oauthTokenStore.saveCodeVerifier(this.serverId, codeVerifier);
  }

  codeVerifier(): string {
    const verifier = oauthTokenStore.getCodeVerifier(this.serverId);
    if (!verifier) {
      throw new Error(`No PKCE code verifier stored for server ${this.serverId}`);
    }
    return verifier;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    if (!this.interactive) {
      // Background connect: do not pop a browser. Signal the UI instead.
      logWarn(
        `[OAuth] Server ${this.serverId} needs interactive auth (non-interactive connect)`
      );
      throw new NeedsInteractiveAuthError(this.serverId);
    }
    log(`[OAuth] Authorization required: ${authorizationUrl.host}`);
    if (this.onRedirect) {
      // The host decides how to present the login page (e.g. an in-app window).
      this.onRedirect(authorizationUrl);
    } else {
      // Fallback: open the system browser.
      void shell.openExternal(authorizationUrl.toString());
    }
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'all') {
      oauthTokenStore.clear(this.serverId, 'all');
    } else if (scope === 'tokens') {
      oauthTokenStore.clear(this.serverId, 'tokens');
    } else if (scope === 'verifier') {
      oauthTokenStore.clear(this.serverId, 'verifier');
    }
    // 'client' / 'discovery' invalidation is a no-op here: re-registration on the
    // next interactive auth overwrites stale client info anyway.
  }
}
