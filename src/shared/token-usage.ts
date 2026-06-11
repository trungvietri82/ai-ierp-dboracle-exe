/** One question's token usage (a user prompt + the assistant turn it triggered). */
export interface TokenUsageRecord {
  id: string;
  sessionId: string;
  sessionTitle: string;
  /** the user's question (trimmed) */
  question: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** OS user that asked */
  createdBy: string;
  /** epoch ms of the question */
  createdAt: number;
}
