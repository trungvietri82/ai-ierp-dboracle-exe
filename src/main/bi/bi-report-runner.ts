/**
 * @module main/bi/bi-report-runner
 *
 * Deterministic render of a BI report to an HTML file the PreviewPanel can open.
 *
 * static  : write htmlContent as-is.
 * dynamic : substitute params into each query's args, call the MCP tool
 *           (no LLM), assemble window.__REPORT_DATA__ and inject it into the
 *           shell, then write the file. Re-running with new params re-queries.
 */
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { log, logError } from '../utils/logger';
import { runPiAiOneShot } from '../claude/claude-sdk-one-shot';
import { configStore } from '../config/config-store';
import { getReport, updateLastData } from './bi-report-store';
import type { BIReport, BIReportQuery } from '../../shared/bi-report';

interface McpCaller {
  callTool(toolName: string, args: Record<string, unknown>): Promise<unknown>;
}

function cacheDir(): string {
  const dir = path.join(app.getPath('userData'), 'bi-reports-cache');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Replace {{param}} tokens inside a string with the provided values. */
function substituteString(value: string, params: Record<string, string | number>): string {
  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, name: string) => {
    const v = params[name];
    return v === undefined || v === null ? '' : String(v);
  });
}

/** Deep-substitute {{param}} in all string leaves of an args object. */
function substituteArgs(
  template: Record<string, unknown>,
  params: Record<string, string | number>
): Record<string, unknown> {
  const walk = (val: unknown): unknown => {
    if (typeof val === 'string') return substituteString(val, params);
    if (Array.isArray(val)) return val.map(walk);
    if (val && typeof val === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) out[k] = walk(v);
      return out;
    }
    return val;
  };
  return walk(template) as Record<string, unknown>;
}

/** Run all queries for a dynamic report and assemble __REPORT_DATA__. */
export async function buildReportData(
  report: BIReport,
  paramValues: Record<string, string | number>,
  mcp: McpCaller
): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = { params: paramValues };
  for (const q of report.queries as BIReportQuery[]) {
    const args = substituteArgs(q.argsTemplate || {}, paramValues);
    try {
      const result = await mcp.callTool(q.tool, args);
      data[q.resultKey] = result;
    } catch (error) {
      logError(`[BIReport] query failed (${q.tool}):`, error);
      data[q.resultKey] = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  return data;
}

/** Inject the data object into the shell so window.__REPORT_DATA__ is set. */
function injectData(shell: string, data: Record<string, unknown>): string {
  // Encode as a JSON string literal to avoid breaking on </script> etc.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const tag = `<script>window.__REPORT_DATA__ = JSON.parse(${JSON.stringify(json)});</script>`;
  if (/<\/head>/i.test(shell)) return shell.replace(/<\/head>/i, `${tag}\n</head>`);
  if (/<body[^>]*>/i.test(shell)) return shell.replace(/(<body[^>]*>)/i, `$1\n${tag}`);
  return tag + '\n' + shell;
}

function writeHtml(id: string, html: string): string {
  const file = path.join(cacheDir(), `${id}.html`);
  fs.writeFileSync(file, html, 'utf8');
  return file;
}

/**
 * Render a report to an HTML file and return its absolute path.
 * For dynamic reports, paramValues drives the MCP re-query.
 */
export async function renderReport(
  id: string,
  paramValues: Record<string, string | number> | undefined,
  mcp: McpCaller | null
): Promise<{ filePath: string }> {
  const report = getReport(id);
  if (!report) throw new Error('Report not found');

  // Static report saved as a file (pdf/docx/xlsx/pptx): open the stored file.
  if (report.type === 'static' && report.filePath && fs.existsSync(report.filePath)) {
    return { filePath: report.filePath };
  }
  // Static HTML snapshot: render as-is (no refresh).
  if (report.type === 'static') {
    return { filePath: writeHtml(report.id, report.htmlContent || '<h1>(empty report)</h1>') };
  }

  // Dynamic (BI) or AI: re-run the captured queries for fresh data, then inject
  // it into the shell. AI reports additionally get a regenerated recommendation.
  const hasQueries = (report.queries?.length ?? 0) > 0;
  if (hasQueries && !mcp) {
    throw new Error('MCP không khả dụng để làm mới báo cáo');
  }
  const data = hasQueries
    ? await buildReportData(report, paramValues || {}, mcp as McpCaller)
    : ((report.lastData as Record<string, unknown>) ?? {});
  try {
    updateLastData(report.id, data);
  } catch (error) {
    logError('[BIReport] updateLastData failed:', error);
  }

  let html = injectData(report.htmlContent || '<body></body>', data);

  if (report.type === 'ai') {
    const recommendation = await generateRecommendation(report, data);
    if (recommendation) html = injectRecommendation(html, recommendation);
  }

  log(`[BIReport] rendered ${report.type} report ${report.id} (${report.queries.length} queries)`);
  return { filePath: writeHtml(report.id, html) };
}

/** AI report: one LLM call turning the fresh data into an updated assessment. */
async function generateRecommendation(
  report: BIReport,
  data: Record<string, unknown>
): Promise<string | null> {
  try {
    const config = configStore.getAll();
    const system =
      'Bạn là chuyên gia phân tích dữ liệu. Dựa trên DỮ LIỆU MỚI, viết phần "Nhận định & Khuyến nghị" ngắn gọn bằng HTML tiếng Việt (vài gạch đầu dòng <ul><li>), nêu xu hướng/rủi ro/đề xuất. KHÔNG lặp lại toàn bộ số liệu thô, KHÔNG bịa số. Chỉ trả về HTML của phần nhận định.';
    const prompt = [
      `Báo cáo: ${report.title}`,
      report.promptTemplate ? `Bối cảnh: ${report.promptTemplate}` : '',
      '',
      'Dữ liệu mới (JSON):',
      JSON.stringify(data).slice(0, 12000),
    ].join('\n');
    const { text } = await runPiAiOneShot(prompt, system, config, {
      temperature: 0.3,
      maxTokens: 1500,
    });
    const trimmed = text.trim();
    return trimmed || null;
  } catch (error) {
    logError('[BIReport] generateRecommendation failed:', error);
    return null;
  }
}

/** Inject the recommendation HTML into the <div id="ai-recommendation"> slot. */
function injectRecommendation(html: string, recommendation: string): string {
  const slot = /(<div[^>]*id=["']ai-recommendation["'][^>]*>)([\s\S]*?)(<\/div>)/i;
  if (slot.test(html)) {
    return html.replace(slot, `$1${recommendation}$3`);
  }
  // No slot found: append a recommendation block before </body>.
  const block = `<div id="ai-recommendation" style="margin:16px;padding:16px;border:1px solid #e5e7eb;border-radius:12px">${recommendation}</div>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${block}</body>`) : html + block;
}
