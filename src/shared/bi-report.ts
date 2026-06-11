/**
 * Shared types for the BI Report feature (saved dashboards).
 *
 * static  : a fixed HTML snapshot, rendered as-is.
 * dynamic : an HTML "shell" that reads window.__REPORT_DATA__, plus a
 *           parameterized set of MCP queries. At view time the app fills the
 *           parameters, calls MCP deterministically (no LLM), assembles
 *           __REPORT_DATA__ and injects it into the shell.
 */

/**
 * static  : fixed HTML snapshot, no refresh.
 * dynamic : "BI" report — deterministic refresh via captured MCP queries (no LLM).
 * ai      : snapshot whose refresh re-runs the agent prompt (uses the LLM).
 */
export type BIReportType = 'static' | 'dynamic' | 'ai';

export type BIParamType = 'text' | 'number' | 'date' | 'select';

export interface BIReportParam {
  /** placeholder name used as {{name}} inside query args */
  name: string;
  /** human label shown in the form */
  label: string;
  type: BIParamType;
  default?: string | number;
  /** options for type 'select' */
  options?: string[];
}

export interface BIReportQuery {
  /** MCP server name (as configured) */
  server: string;
  /** MCP tool name to call */
  tool: string;
  /** tool arguments; string values may contain {{param}} placeholders */
  argsTemplate: Record<string, unknown>;
  /** key under window.__REPORT_DATA__ where this query's result is stored */
  resultKey: string;
}

export interface BIReportSummary {
  id: string;
  title: string;
  type: BIReportType;
  description: string | null;
  category: string | null;
  /** OS username that saved the report */
  createdBy: string | null;
  /** source file kind: 'html' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | ... (null = html snapshot) */
  fileType: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface BIReport extends BIReportSummary {
  sessionId: string | null;
  /** static/ai: full HTML snapshot; dynamic: HTML shell reading __REPORT_DATA__ */
  htmlContent: string | null;
  params: BIReportParam[];
  queries: BIReportQuery[];
  /** optional extra mapping spec (reserved) */
  binding: unknown | null;
  /** cache of the last produced __REPORT_DATA__ for dynamic reports */
  lastData: unknown | null;
  /** ai: the prompt to re-run on refresh (may contain {{param}}) */
  promptTemplate: string | null;
  /** for file-based reports (docx/xlsx/pptx/pdf/html): stored copy path */
  filePath: string | null;
}

interface SaveCommon {
  title: string;
  description?: string | null;
  category?: string | null;
  sessionId?: string | null;
}

export interface SaveStaticReportInput extends SaveCommon {
  /** html dashboard snapshot (for .html reports) */
  htmlContent?: string;
  /** absolute path of a generated file to copy & save (docx/xlsx/pptx/pdf/html) */
  sourceFilePath?: string;
  /** source working dir for resolving sourceFilePath */
  sourceCwd?: string;
  /** file extension/kind, e.g. 'pdf','docx','xlsx','pptx','html' */
  fileType?: string;
}

export interface SaveDynamicReportInput extends SaveCommon {
  htmlContent: string; // shell
  params: BIReportParam[];
  queries: BIReportQuery[];
  binding?: unknown;
}

export interface SaveAiReportInput extends SaveCommon {
  htmlContent: string; // snapshot
  promptTemplate: string;
  params?: BIReportParam[];
  /** captured MCP queries, so AI refresh can re-run them for fresh data */
  queries?: BIReportQuery[];
}

/** Result of analyzing a chat session to power the save dialog. */
export interface SessionReportAnalysis {
  /** MCP tool calls captured from the session trace */
  queries: BIReportQuery[];
  queryCount: number;
  /** the user's prompt (for the AI report) */
  prompt: string | null;
}
