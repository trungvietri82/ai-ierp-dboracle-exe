import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  X,
  RefreshCw,
  Trash2,
  FileText,
  SlidersHorizontal,
  Bot,
  Search,
  ChevronUp,
  ChevronDown,
  RotateCw,
} from 'lucide-react';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import type { BIReport, BIReportSummary, BIReportParam } from '../../shared/bi-report';
import { aiSquare, baocaoBI, baocaoTinh } from '../assets/report-icons';

const TYPE_LABEL: Record<string, string> = {
  static: 'Tĩnh',
  dynamic: 'Báo cáo BI',
  ai: 'Báo cáo AI',
};

type SortKey = 'title' | 'description' | 'type' | 'createdBy' | 'createdAt';
type SortDir = 'asc' | 'desc';

const COLUMNS: { key: SortKey; label: string; width?: string }[] = [
  { key: 'title', label: 'Tên báo cáo' },
  { key: 'description', label: 'Diễn giải' },
  { key: 'type', label: 'Loại báo cáo', width: 'w-44' },
  { key: 'createdBy', label: 'Người tạo', width: 'w-40' },
  { key: 'createdAt', label: 'Ngày giờ tạo', width: 'w-48' },
];

function cellText(r: BIReportSummary, key: SortKey): string {
  switch (key) {
    case 'title':
      return r.title;
    case 'description':
      return r.description || '';
    case 'type':
      return `${TYPE_LABEL[r.type] || r.type} ${r.fileType || ''}`;
    case 'createdBy':
      return r.createdBy || '';
    case 'createdAt':
      return new Date(r.createdAt).toLocaleString();
  }
}

/**
 * BI Reports view: a sortable + filterable table of saved dashboards.
 * - global search box (searches all columns)
 * - per-column filter inputs
 * - click a column header to sort
 * Clicking a row opens the report (static/ai → snapshot; dynamic → params first).
 */
export function BIReportsView() {
  const setShowBIReports = useAppStore((s) => s.setShowBIReports);
  const setPreviewFile = useAppStore((s) => s.setPreviewFile);
  const { startSession } = useIPC();
  const bi = typeof window !== 'undefined' ? window.electronAPI?.bi : undefined;

  const [reports, setReports] = useState<BIReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [paramTarget, setParamTarget] = useState<BIReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [colFilters, setColFilters] = useState<Record<SortKey, string>>({
    title: '',
    description: '',
    type: '',
    createdBy: '',
    createdAt: '',
  });
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: 'createdAt',
    dir: 'desc',
  });

  const refresh = useCallback(async () => {
    if (!bi) return;
    setLoading(true);
    try {
      setReports(await bi.list());
    } finally {
      setLoading(false);
    }
  }, [bi]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = reports.filter((r) => {
      if (q) {
        const hay = COLUMNS.map((c) => cellText(r, c.key)).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      for (const c of COLUMNS) {
        const f = colFilters[c.key].trim().toLowerCase();
        if (f && !cellText(r, c.key).toLowerCase().includes(f)) return false;
      }
      return true;
    });
    list.sort((a, b) => {
      let cmp: number;
      if (sort.key === 'createdAt') cmp = a.createdAt - b.createdAt;
      else cmp = cellText(a, sort.key).toLowerCase().localeCompare(cellText(b, sort.key).toLowerCase());
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [reports, query, colFilters, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    );
  const setColFilter = (key: SortKey, v: string) =>
    setColFilters((prev) => ({ ...prev, [key]: v }));

  const renderToPreview = useCallback(
    async (id: string, type: string, params?: Record<string, string | number>) => {
      if (!bi) return;
      setBusyId(id);
      setError(null);
      try {
        const { filePath } = await bi.render(id, params);
        setPreviewFile({ path: filePath, reportId: id, reportType: type });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Không mở được báo cáo');
      } finally {
        setBusyId(null);
      }
    },
    [bi, setPreviewFile]
  );

  const openReport = useCallback(
    async (summary: BIReportSummary) => {
      if (summary.type === 'dynamic') {
        if (!bi) return;
        const full = await bi.get(summary.id);
        if (full && full.params && full.params.length > 0) {
          setParamTarget(full);
          return;
        }
      }
      await renderToPreview(summary.id, summary.type, {});
    },
    [bi, renderToPreview]
  );

  const handleDelete = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      if (!bi) return;
      await bi.delete(id);
      await refresh();
    },
    [bi, refresh]
  );

  // AI report refresh: re-run the saved prompt as a fresh chat session so the
  // agent re-queries MCP and re-derives its assessment.
  const handleRunAi = useCallback(
    async (e: React.MouseEvent, summary: BIReportSummary) => {
      e.stopPropagation();
      if (!bi) return;
      const full = await bi.get(summary.id);
      if (!full || !full.promptTemplate) {
        setError('Báo cáo AI này không có prompt để chạy lại.');
        return;
      }
      setShowBIReports(false);
      await startSession(full.title || 'Chạy lại báo cáo', full.promptTemplate);
    },
    [bi, startSession, setShowBIReports]
  );

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border-muted px-6 py-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-accent" />
          <h1 className="text-lg font-semibold text-text-primary">Báo cáo BI</h1>
          <span className="text-xs text-text-muted">
            ({rows.length}/{reports.length})
          </span>
        </div>
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm kiếm tất cả…"
            className="w-full rounded-xl border border-border-muted bg-surface py-2 pl-9 pr-3 text-sm text-text-primary outline-none focus:border-accent"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            title="Tải lại"
            className="rounded-lg p-2 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => setShowBIReports(false)}
            title="Đóng"
            className="rounded-lg p-2 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && <div className="px-6 pt-3 text-sm text-red-500">{error}</div>}

      <div className="flex-1 overflow-auto px-6 py-4">
        {!loading && reports.length === 0 ? (
          <div className="mt-20 text-center text-text-secondary">
            Chưa có báo cáo nào được lưu.
            <div className="mt-1 text-xs">
              Trong khung chat, tạo dashboard/báo cáo rồi bấm “Lưu báo cáo”.
            </div>
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-background">
              <tr className="text-left text-xs font-medium text-text-muted">
                {COLUMNS.map((c) => (
                  <th key={c.key} className={`px-3 pb-1 pt-0 align-bottom ${c.width || ''}`}>
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className="flex items-center gap-1 uppercase tracking-wide hover:text-text-primary"
                    >
                      {c.label}
                      {sort.key === c.key &&
                        (sort.dir === 'asc' ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        ))}
                    </button>
                    <input
                      value={colFilters[c.key]}
                      onChange={(e) => setColFilter(c.key, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="Lọc…"
                      className="mt-1.5 w-full rounded-md border border-border-muted bg-surface px-2 py-1 text-[11px] font-normal normal-case text-text-primary outline-none focus:border-accent"
                    />
                  </th>
                ))}
                <th className="w-20 px-3" />
              </tr>
              <tr>
                <td colSpan={COLUMNS.length + 1} className="border-b border-border-muted p-0" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => void openReport(r)}
                  className={`group cursor-pointer border-b border-border-muted transition-colors hover:bg-surface-hover ${
                    busyId === r.id ? 'opacity-60' : ''
                  }`}
                >
                  <td className="px-3 py-3">
                    <div className="font-medium text-text-primary">{r.title}</div>
                  </td>
                  <td className="px-3 py-3 text-text-secondary">
                    <div className="max-w-xs truncate" title={r.description || ''}>
                      {r.description || '—'}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <TypeBadge report={r} />
                  </td>
                  <td className="px-3 py-3 text-text-secondary">{r.createdBy || '—'}</td>
                  <td className="px-3 py-3 text-text-secondary">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {r.type === 'ai' && (
                        <button
                          type="button"
                          onClick={(e) => handleRunAi(e, r)}
                          title="Chạy lại bằng AI"
                          className="rounded-lg p-1.5 text-text-muted opacity-0 transition-opacity hover:bg-surface-hover hover:text-accent group-hover:opacity-100"
                        >
                          <RotateCw className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => handleDelete(e, r.id)}
                        title="Xóa"
                        className="rounded-lg p-1.5 text-text-muted opacity-0 transition-opacity hover:bg-surface-hover hover:text-red-500 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="py-10 text-center text-text-muted">
                    Không có báo cáo khớp bộ lọc.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {paramTarget && (
        <ParamDialog
          report={paramTarget}
          onCancel={() => setParamTarget(null)}
          onRun={async (values) => {
            const target = paramTarget;
            setParamTarget(null);
            await renderToPreview(target.id, target.type, values);
          }}
        />
      )}
    </div>
  );
}

function TypeBadge({ report }: { report: BIReportSummary }) {
  const kind =
    report.type === 'dynamic'
      ? {
          label: 'Báo cáo BI',
          icon: <SlidersHorizontal className="h-3.5 w-3.5" />,
          grad: 'from-sky-400 to-blue-600',
          img: baocaoBI as string | undefined,
          blend: true,
        }
      : report.type === 'ai'
        ? {
            label: 'Báo cáo AI',
            icon: <Bot className="h-3.5 w-3.5" />,
            grad: 'from-fuchsia-400 to-purple-600',
            img: aiSquare as string | undefined,
            blend: false,
          }
        : {
            label: 'Tĩnh',
            icon: <FileText className="h-3.5 w-3.5" />,
            grad: 'from-slate-400 to-slate-600',
            img: baocaoTinh as string | undefined,
            blend: true,
          };
  const ft = report.fileType && report.fileType !== 'html' ? report.fileType.toUpperCase() : '';
  return (
    <span className="inline-flex items-center gap-2">
      {kind.img ? (
        kind.blend ? (
          <img
            src={kind.img}
            alt={kind.label}
            className="h-6 w-6 object-contain mix-blend-multiply dark:mix-blend-screen"
          />
        ) : (
          <img
            src={kind.img}
            alt={kind.label}
            className="h-6 w-6 rounded-lg object-cover shadow-sm ring-1 ring-white/20"
          />
        )
      ) : (
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm ring-1 ring-white/20 ${kind.grad}`}
        >
          {kind.icon}
        </span>
      )}
      <span className="text-sm text-text-primary">{kind.label}</span>
      {ft && <span className="text-xs text-text-muted">{ft}</span>}
    </span>
  );
}

function ParamDialog({
  report,
  onCancel,
  onRun,
}: {
  report: BIReport;
  onCancel: () => void;
  onRun: (values: Record<string, string | number>) => void;
}) {
  const [values, setValues] = useState<Record<string, string | number>>(() => {
    const init: Record<string, string | number> = {};
    for (const p of report.params) init[p.name] = p.default ?? '';
    return init;
  });
  const set = (p: BIReportParam, v: string) =>
    setValues((prev) => ({ ...prev, [p.name]: p.type === 'number' ? Number(v) : v }));

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="w-full max-w-md rounded-2xl border border-border-muted bg-surface p-6 shadow-xl">
        <h2 className="mb-1 text-base font-semibold text-text-primary">{report.title}</h2>
        <p className="mb-4 text-xs text-text-secondary">
          Chọn tham số để truy vấn dữ liệu mới nhất.
        </p>
        <div className="space-y-3">
          {report.params.map((p) => (
            <label key={p.name} className="block">
              <span className="mb-1 block text-xs text-text-secondary">{p.label || p.name}</span>
              {p.type === 'select' && p.options ? (
                <select
                  value={String(values[p.name] ?? '')}
                  onChange={(e) => set(p, e.target.value)}
                  className="w-full rounded-xl border border-border-muted bg-background px-3 py-2 text-sm text-text-primary"
                >
                  {p.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={p.type === 'number' ? 'number' : p.type === 'date' ? 'date' : 'text'}
                  value={String(values[p.name] ?? '')}
                  onChange={(e) => set(p, e.target.value)}
                  className="w-full rounded-xl border border-border-muted bg-background px-3 py-2 text-sm text-text-primary"
                />
              )}
            </label>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-sm text-text-secondary hover:bg-surface-hover"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={() => onRun(values)}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Tạo báo cáo
          </button>
        </div>
      </div>
    </div>
  );
}
