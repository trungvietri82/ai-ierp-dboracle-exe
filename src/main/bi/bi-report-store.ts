/**
 * @module main/bi/bi-report-store
 *
 * CRUD for saved BI reports (bi_reports table). Uses the raw db.prepare API.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/database';
import type {
  BIReport,
  BIReportType,
  BIReportSummary,
  SaveStaticReportInput,
  SaveDynamicReportInput,
  SaveAiReportInput,
} from '../../shared/bi-report';

interface BIReportRow {
  id: string;
  title: string;
  type: string;
  description: string | null;
  category: string | null;
  session_id: string | null;
  html_content: string | null;
  params_json: string | null;
  queries_json: string | null;
  binding_json: string | null;
  last_data_json: string | null;
  prompt_template: string | null;
  created_by: string | null;
  file_type: string | null;
  file_path: string | null;
  created_at: number;
  updated_at: number;
}

/** Directory where saved report files (copies) are stored. */
function reportsStoreDir(): string {
  const dir = path.join(app.getPath('userData'), 'bi-reports-store');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function normalizeType(t: string): BIReportType {
  return t === 'dynamic' || t === 'ai' ? t : 'static';
}

function currentUser(): string {
  try {
    return os.userInfo().username || '';
  } catch {
    return '';
  }
}

function parse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function rowToReport(row: BIReportRow): BIReport {
  return {
    id: row.id,
    title: row.title,
    type: normalizeType(row.type),
    description: row.description ?? null,
    category: row.category,
    sessionId: row.session_id,
    htmlContent: row.html_content,
    params: parse(row.params_json, []),
    queries: parse(row.queries_json, []),
    binding: parse(row.binding_json, null),
    lastData: parse(row.last_data_json, null),
    promptTemplate: row.prompt_template ?? null,
    createdBy: row.created_by ?? null,
    fileType: row.file_type ?? null,
    filePath: row.file_path ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSummary(row: BIReportRow): BIReportSummary {
  return {
    id: row.id,
    title: row.title,
    type: normalizeType(row.type),
    description: row.description ?? null,
    category: row.category,
    createdBy: row.created_by ?? null,
    fileType: row.file_type ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** List report summaries (no heavy html), newest first. */
export function listReports(): BIReportSummary[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT id, title, type, description, category, created_by, file_type,
              created_at, updated_at,
              NULL as session_id, NULL as html_content, NULL as params_json,
              NULL as queries_json, NULL as binding_json, NULL as last_data_json,
              NULL as prompt_template, NULL as file_path
       FROM bi_reports ORDER BY created_at DESC`
    )
    .all() as BIReportRow[];
  return rows.map(rowToSummary);
}

/** Full report by id (includes html + params + queries). */
export function getReport(id: string): BIReport | null {
  const db = getDatabase();
  const row = db.prepare(`SELECT * FROM bi_reports WHERE id = ?`).get(id) as
    | BIReportRow
    | undefined;
  return row ? rowToReport(row) : null;
}

const INSERT_SQL = `INSERT INTO bi_reports
   (id, title, type, description, category, session_id, html_content,
    params_json, queries_json, binding_json, last_data_json, prompt_template,
    created_by, file_type, file_path, created_at, updated_at)
 VALUES (@id, @title, @type, @description, @category, @session_id, @html_content,
    @params_json, @queries_json, @binding_json, NULL, @prompt_template,
    @created_by, @file_type, @file_path, @created_at, @updated_at)`;

export function saveStaticReport(input: SaveStaticReportInput): BIReport {
  const db = getDatabase();
  const now = Date.now();
  const id = uuidv4();

  let filePath: string | null = null;
  let fileType: string | null = input.fileType ? input.fileType.toLowerCase() : null;
  let htmlContent: string | null = input.htmlContent ?? null;

  // File-based report (docx/xlsx/pptx/pdf/html): copy the generated file into
  // the reports store so it persists independently of the working directory.
  if (input.sourceFilePath) {
    const src = path.isAbsolute(input.sourceFilePath)
      ? input.sourceFilePath
      : path.resolve(input.sourceCwd || process.cwd(), input.sourceFilePath);
    const ext = (
      input.fileType ||
      path.extname(src).replace(/^\./, '') ||
      'bin'
    ).toLowerCase();
    fileType = ext;
    const dest = path.join(reportsStoreDir(), `${id}.${ext}`);
    fs.copyFileSync(src, dest);
    filePath = dest;
    if (ext === 'html' && !htmlContent) {
      try {
        htmlContent = fs.readFileSync(dest, 'utf8');
      } catch {
        /* ignore */
      }
    }
  } else if (htmlContent) {
    fileType = fileType || 'html';
  }

  db.prepare(INSERT_SQL).run({
    id,
    title: input.title,
    type: 'static',
    description: input.description ?? null,
    category: input.category ?? null,
    session_id: input.sessionId ?? null,
    html_content: htmlContent,
    params_json: null,
    queries_json: null,
    binding_json: null,
    prompt_template: null,
    created_by: currentUser(),
    file_type: fileType,
    file_path: filePath,
    created_at: now,
    updated_at: now,
  });
  return getReport(id)!;
}

export function saveDynamicReport(input: SaveDynamicReportInput): BIReport {
  const db = getDatabase();
  const now = Date.now();
  const id = uuidv4();
  db.prepare(INSERT_SQL).run({
    id,
    title: input.title,
    type: 'dynamic',
    description: input.description ?? null,
    category: input.category ?? null,
    session_id: input.sessionId ?? null,
    html_content: input.htmlContent,
    params_json: JSON.stringify(input.params ?? []),
    queries_json: JSON.stringify(input.queries ?? []),
    binding_json: input.binding != null ? JSON.stringify(input.binding) : null,
    prompt_template: null,
    created_by: currentUser(),
    file_type: null,
    file_path: null,
    created_at: now,
    updated_at: now,
  });
  return getReport(id)!;
}

export function saveAiReport(input: SaveAiReportInput): BIReport {
  const db = getDatabase();
  const now = Date.now();
  const id = uuidv4();
  db.prepare(INSERT_SQL).run({
    id,
    title: input.title,
    type: 'ai',
    description: input.description ?? null,
    category: input.category ?? null,
    session_id: input.sessionId ?? null,
    html_content: input.htmlContent,
    params_json: JSON.stringify(input.params ?? []),
    queries_json: JSON.stringify(input.queries ?? []),
    binding_json: null,
    prompt_template: input.promptTemplate,
    created_by: currentUser(),
    file_type: null,
    file_path: null,
    created_at: now,
    updated_at: now,
  });
  return getReport(id)!;
}

/** Duplicate an existing report under a new title (same type). "Save as". */
export function duplicateReport(
  id: string,
  title: string,
  description: string | null
): BIReport | null {
  const src = getReport(id);
  if (!src) return null;
  const db = getDatabase();
  const now = Date.now();
  const newId = uuidv4();

  let filePath: string | null = null;
  if (src.filePath && fs.existsSync(src.filePath)) {
    const ext = src.fileType || path.extname(src.filePath).replace(/^\./, '') || 'bin';
    const dest = path.join(reportsStoreDir(), `${newId}.${ext}`);
    fs.copyFileSync(src.filePath, dest);
    filePath = dest;
  }

  db.prepare(INSERT_SQL).run({
    id: newId,
    title,
    type: src.type,
    description,
    category: src.category,
    session_id: src.sessionId,
    html_content: src.htmlContent,
    params_json: JSON.stringify(src.params ?? []),
    queries_json: JSON.stringify(src.queries ?? []),
    binding_json: src.binding != null ? JSON.stringify(src.binding) : null,
    prompt_template: src.promptTemplate,
    created_by: currentUser(),
    file_type: src.fileType,
    file_path: filePath,
    created_at: now,
    updated_at: now,
  });
  return getReport(newId);
}

/** Cache the most recent produced data for a dynamic report. */
export function updateLastData(id: string, data: unknown): void {
  const db = getDatabase();
  db.prepare(`UPDATE bi_reports SET last_data_json = ?, updated_at = ? WHERE id = ?`).run(
    JSON.stringify(data ?? null),
    Date.now(),
    id
  );
}

export function renameReport(id: string, title: string): void {
  const db = getDatabase();
  db.prepare(`UPDATE bi_reports SET title = ?, updated_at = ? WHERE id = ?`).run(
    title,
    Date.now(),
    id
  );
}

export function deleteReport(id: string): void {
  const db = getDatabase();
  db.prepare(`DELETE FROM bi_reports WHERE id = ?`).run(id);
}
