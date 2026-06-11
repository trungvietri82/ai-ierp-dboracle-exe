/**
 * @module main/bi/bi-report-analyzer
 *
 * Inspects a chat session to power the "Save report" dialog:
 *  - captures the MCP tool calls (queries) that produced the dashboard, so a
 *    "BI" (deterministic) report can re-run them on refresh without the LLM;
 *  - extracts the user's prompt, used as the template for an "AI" report.
 *
 * Pure logic — the caller passes in trace steps, the MCP tool name set and the
 * messages (kept electron-free so it stays unit-testable).
 */
import type { BIReportQuery, SessionReportAnalysis } from '../../shared/bi-report';

interface TraceLike {
  toolName?: string;
  toolInput?: Record<string, unknown>;
  type?: string;
}

interface MessageLike {
  role: string;
  content: unknown;
}

function sanitizeKey(name: string, index: number): string {
  const base = name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'q';
  return `${base}_${index}`;
}

/** Pull plain text out of a message's content (string or content-block array). */
function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === 'string') return b;
        if (b && typeof b === 'object') {
          const obj = b as Record<string, unknown>;
          if (typeof obj.text === 'string') return obj.text;
          if (typeof obj.content === 'string') return obj.content;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export function analyzeSessionForReport(
  traceSteps: TraceLike[],
  mcpToolNames: Map<string, string>, // name -> serverName
  messages: MessageLike[]
): SessionReportAnalysis {
  const queries: BIReportQuery[] = [];
  const seen = new Set<string>();

  for (const step of traceSteps) {
    const tool = step.toolName;
    if (!tool || !mcpToolNames.has(tool)) continue;
    const args = (step.toolInput && typeof step.toolInput === 'object' ? step.toolInput : {}) as Record<
      string,
      unknown
    >;
    const dedupeKey = `${tool}::${JSON.stringify(args)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    queries.push({
      server: mcpToolNames.get(tool) || '',
      tool,
      argsTemplate: args,
      resultKey: sanitizeKey(tool, queries.length + 1),
    });
  }

  // First non-empty user message becomes the AI prompt template.
  let prompt: string | null = null;
  for (const m of messages) {
    if (m.role === 'user') {
      const text = messageText(m.content).trim();
      if (text) {
        prompt = text;
        break;
      }
    }
  }

  return { queries, queryCount: queries.length, prompt };
}
