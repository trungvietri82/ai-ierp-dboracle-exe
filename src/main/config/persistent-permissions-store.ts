/**
 * @module main/config/persistent-permissions-store
 *
 * Disk-persisted list of tools the user chose to "always allow" via the
 * permission dialog. Stored by canonical tool name (lowercased), e.g.
 * 'mcp__trungpq_oracle__run_query' or 'bash'.
 *
 * Hydrated into permission-rules-store at startup (see main/index.ts) so an
 * "always allow" grant survives across chat sessions AND app restarts —
 * matching the claude.ai-style persistent tool permission.
 *
 * Kept separate from permission-rules-store so that security-critical module
 * stays free of electron / electron-store dependencies and remains unit-
 * testable in isolation.
 */
import Store, { type Options as StoreOptions } from 'electron-store';

interface PermissionsSchema {
  alwaysAllowedTools: string[];
}

const store = new Store<PermissionsSchema>({
  projectName: 'ai-ierp',
  name: 'permissions',
  defaults: { alwaysAllowedTools: [] },
} as StoreOptions<PermissionsSchema> & { projectName?: string });

function normalize(tool: string): string {
  return tool.trim().toLowerCase();
}

/** All persistently allowed tools (lowercased canonical names). */
export function getAlwaysAllowedTools(): string[] {
  const list = store.get('alwaysAllowedTools', []);
  return Array.isArray(list) ? list.filter((t): t is string => typeof t === 'string') : [];
}

/** Persist a tool to the always-allow list (idempotent). */
export function addAlwaysAllowedTool(tool: string): void {
  const t = normalize(tool);
  if (!t) return;
  const list = getAlwaysAllowedTools();
  if (!list.includes(t)) {
    store.set('alwaysAllowedTools', [...list, t]);
  }
}

/** Revoke a previously granted tool. */
export function removeAlwaysAllowedTool(tool: string): void {
  const t = normalize(tool);
  store.set(
    'alwaysAllowedTools',
    getAlwaysAllowedTools().filter((x) => x !== t)
  );
}

/** Revoke all persistent grants. */
export function clearAlwaysAllowedTools(): void {
  store.set('alwaysAllowedTools', []);
}
