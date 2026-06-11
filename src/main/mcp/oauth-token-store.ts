/**
 * @module main/mcp/oauth-token-store
 *
 * Persistent storage for OAuth 2.1 credentials of MCP servers (PC1-style
 * OAuth-protected MCP servers). One record per MCP server id, holding:
 * - the dynamically-registered client information (RFC 7591),
 * - the access/refresh tokens (so we only authenticate once at assignment time),
 * - the transient PKCE code verifier used during an in-flight authorization.
 *
 * Backed by electron-store (encryptionKey provides at-rest obfuscation, the same
 * level of protection used by the rest of the app's local stores).
 */
import Store, { type Options as StoreOptions } from 'electron-store';
import type {
  OAuthTokens,
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { log } from '../utils/logger';

interface OAuthServerRecord {
  /** Client info from dynamic client registration (or pre-registered). */
  clientInformation?: OAuthClientInformationFull;
  /** Access + refresh tokens issued by the authorization server. */
  tokens?: OAuthTokens;
  /** PKCE code verifier — only present while an authorization is in flight. */
  codeVerifier?: string;
}

interface OAuthStoreSchema {
  /** Keyed by MCP server id. */
  servers: Record<string, OAuthServerRecord>;
}

class OAuthTokenStore {
  private store: Store<OAuthStoreSchema>;

  constructor() {
    const storeOptions: StoreOptions<OAuthStoreSchema> & { projectName?: string } = {
      name: 'mcp-oauth',
      projectName: 'ai-ierp',
      encryptionKey: 'open-cowork-mcp-oauth-v1',
      defaults: { servers: {} },
    };
    this.store = new Store<OAuthStoreSchema>(storeOptions);
  }

  private getRecord(serverId: string): OAuthServerRecord {
    const servers = this.store.get('servers', {});
    return servers[serverId] || {};
  }

  private setRecord(serverId: string, record: OAuthServerRecord): void {
    const servers = { ...this.store.get('servers', {}) };
    servers[serverId] = record;
    this.store.set('servers', servers);
  }

  getClientInformation(serverId: string): OAuthClientInformationFull | undefined {
    return this.getRecord(serverId).clientInformation;
  }

  saveClientInformation(serverId: string, info: OAuthClientInformationMixed): void {
    const record = this.getRecord(serverId);
    record.clientInformation = info as OAuthClientInformationFull;
    this.setRecord(serverId, record);
    log(`[OAuthStore] Saved client information for server ${serverId}`);
  }

  getTokens(serverId: string): OAuthTokens | undefined {
    return this.getRecord(serverId).tokens;
  }

  saveTokens(serverId: string, tokens: OAuthTokens): void {
    const record = this.getRecord(serverId);
    record.tokens = tokens;
    this.setRecord(serverId, record);
    log(`[OAuthStore] Saved tokens for server ${serverId}`);
  }

  getCodeVerifier(serverId: string): string | undefined {
    return this.getRecord(serverId).codeVerifier;
  }

  saveCodeVerifier(serverId: string, codeVerifier: string): void {
    const record = this.getRecord(serverId);
    record.codeVerifier = codeVerifier;
    this.setRecord(serverId, record);
  }

  /** Whether this server has completed authentication (has tokens). */
  hasTokens(serverId: string): boolean {
    return Boolean(this.getRecord(serverId).tokens?.access_token);
  }

  /**
   * Clear stored credentials for a server.
   * scope 'tokens' keeps the registered client but forces re-login;
   * 'all' wipes everything (used on disconnect/delete).
   */
  clear(serverId: string, scope: 'all' | 'tokens' | 'verifier' = 'all'): void {
    if (scope === 'all') {
      const servers = { ...this.store.get('servers', {}) };
      delete servers[serverId];
      this.store.set('servers', servers);
      log(`[OAuthStore] Cleared all credentials for server ${serverId}`);
      return;
    }
    const record = this.getRecord(serverId);
    if (scope === 'tokens') {
      delete record.tokens;
      delete record.codeVerifier;
    } else if (scope === 'verifier') {
      delete record.codeVerifier;
    }
    this.setRecord(serverId, record);
  }
}

// Singleton instance
export const oauthTokenStore = new OAuthTokenStore();
