export { DEFAULT_SESSION_TITLE, getDefaultTitleFromPrompt } from '../../shared/session-title';
import { DEFAULT_SESSION_TITLE, getDefaultTitleFromPrompt } from '../../shared/session-title';

export type TitleDecisionInput = {
  userMessageCount: number;
  currentTitle: string;
  prompt: string;
  hasAttempted: boolean;
};

export function shouldGenerateTitle(input: TitleDecisionInput): boolean {
  if (input.hasAttempted) return false;
  if (input.userMessageCount !== 1) return false;
  const defaultTitle = getDefaultTitleFromPrompt(input.prompt);
  return input.currentTitle === defaultTitle || input.currentTitle === DEFAULT_SESSION_TITLE;
}

/** Han (Chinese) + Japanese kana ranges — used to detect a wrong-language title. */
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

export function normalizeGeneratedTitle(
  value: string | null | undefined,
  sourcePrompt?: string
): string | null {
  if (!value) return null;
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return null;
  const normalized = firstLine.replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!normalized) return null;
  if (
    normalized.toLowerCase() === '(no content)' ||
    normalized.toLowerCase() === '(empty content)'
  ) {
    return null;
  }
  // Guard against models (e.g. DeepSeek) defaulting to Chinese: if the title has
  // CJK but the user's request does not, reject it so we fall back to a title
  // derived from the user's own (e.g. Vietnamese) words.
  if (sourcePrompt && CJK_RE.test(normalized) && !CJK_RE.test(sourcePrompt)) {
    return null;
  }
  return normalized.slice(0, 120);
}

export function buildTitlePrompt(prompt: string): string {
  return [
    'Generate a short conversation title for the user request below.',
    'Rules:',
    '- Write the title in the SAME language as the user request.',
    '  If the user wrote Vietnamese, the title MUST be Vietnamese.',
    '- NEVER use Chinese characters unless the user actually wrote in Chinese.',
    '- Max 6 words (about 30 characters).',
    '- No quotes, no numbering, no trailing punctuation.',
    '- Reply with ONLY the title text, nothing else.',
    '',
    `User request: ${prompt.trim()}`,
  ].join('\n');
}
