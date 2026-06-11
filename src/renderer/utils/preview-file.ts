// File types that can be previewed in-app. Everything else (e.g. .docx/.xlsx)
// is opened with the OS default app instead.
const PREVIEWABLE_EXTS = new Set([
  'html', 'htm', 'pdf',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico',
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'xml', 'yml', 'yaml',
  'js', 'mjs', 'ts', 'tsx', 'jsx', 'css', 'py', 'sql', 'sh',
]);

/** Whether a file path/name can be shown in the in-app preview panel. */
export function isPreviewableFile(pathOrName: string): boolean {
  const base = (pathOrName || '').split(/[\\/]/).pop() || '';
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : '';
  return PREVIEWABLE_EXTS.has(ext);
}
