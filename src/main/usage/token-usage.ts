/**
 * @module main/usage/token-usage
 *
 * Derives a per-question token-usage log from the existing messages/sessions
 * tables (no extra capture on the hot path). For each user message we sum the
 * token usage of the assistant messages it triggered, up to the next user
 * message — that is one "question".
 */
import * as os from 'os';
import { getDatabase } from '../db/database';
import { logError } from '../utils/logger';
import type { TokenUsageRecord } from '../../shared/token-usage';

function currentUser(): string {
  try {
    return os.userInfo().username || '';
  } catch {
    return '';
  }
}

/** Extract plain question text from a message's stored content JSON. */
function questionText(contentJson: string): string {
  try {
    const parsed = JSON.parse(contentJson);
    if (typeof parsed === 'string') return parsed;
    if (Array.isArray(parsed)) {
      const text = parsed
        .map((b) => {
          if (typeof b === 'string') return b;
          if (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string') {
            return (b as { text: string }).text;
          }
          return '';
        })
        .filter(Boolean)
        .join(' ')
        .trim();
      return text;
    }
  } catch {
    /* fall through */
  }
  return '';
}

function parseUsage(tokenUsageJson: string | null): { input: number; output: number } {
  if (!tokenUsageJson) return { input: 0, output: 0 };
  try {
    const u = JSON.parse(tokenUsageJson) as { input?: number; output?: number };
    return { input: Number(u.input) || 0, output: Number(u.output) || 0 };
  } catch {
    return { input: 0, output: 0 };
  }
}

export function getTokenUsageLog(): TokenUsageRecord[] {
  try {
    const db = getDatabase();
    const sessions = db.sessions.getAll();
    const user = currentUser();
    const records: TokenUsageRecord[] = [];

    for (const session of sessions) {
      const messages = db.messages
        .getBySessionId(session.id)
        .slice()
        .sort((a, b) => a.timestamp - b.timestamp);

      let current: TokenUsageRecord | null = null;
      for (const m of messages) {
        if (m.role === 'user') {
          if (current && current.totalTokens > 0) records.push(current);
          current = {
            id: m.id,
            sessionId: session.id,
            sessionTitle: session.title || '(không tiêu đề)',
            question: questionText(m.content),
            model: session.model || '',
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            createdBy: user,
            createdAt: m.timestamp,
          };
        } else if (m.role === 'assistant' && current) {
          const usage = parseUsage(m.token_usage);
          current.inputTokens += usage.input;
          current.outputTokens += usage.output;
          current.totalTokens = current.inputTokens + current.outputTokens;
        }
      }
      if (current && current.totalTokens > 0) records.push(current);
    }

    // newest first
    records.sort((a, b) => b.createdAt - a.createdAt);
    return records;
  } catch (error) {
    logError('[TokenUsage] getTokenUsageLog failed:', error);
    return [];
  }
}
