import { useEffect, useMemo, useState } from 'react';
import { Bot, ClipboardList, Save, X, Loader2 } from 'lucide-react';
import type { BIReportType, SessionReportAnalysis } from '../../shared/bi-report';
import { aiSquare, baocaoTinh } from '../assets/report-icons';

/**
 * "Lưu Dashboard" dialog — pick one of three report kinds:
 *  - ai      : snapshot whose refresh re-runs the agent prompt (uses the LLM).
 *  - dynamic : "BI" report — refresh re-runs captured MCP queries (no LLM).
 *  - static  : fixed snapshot, no refresh.
 */
type Props = {
  fileName: string;
  fileType: string; // extension, e.g. 'html','pdf','docx'
  htmlContent?: string;
  sourceFilePath?: string;
  sourceCwd?: string;
  sessionId: string | null;
  /** When set, the dialog is in "Save as" mode: only rename + duplicate the
   *  existing report (same type), no type selection. Used when re-viewing. */
  saveAs?: { reportId: string; type: BIReportType };
  onClose: () => void;
  onSaved: () => void;
};

const CARDS: {
  type: BIReportType;
  title: string;
  icon: React.ReactNode;
  desc: string;
  grad: string;
  img?: string;
  blend?: boolean; // drop white image background by blending into the surface
}[] = [
  {
    type: 'ai',
    title: 'Báo cáo AI',
    icon: <Bot className="h-6 w-6" />,
    img: aiSquare,
    desc: 'Snapshot, refresh = gọi AI',
    grad: 'from-fuchsia-400 to-purple-600 shadow-purple-500/40',
  },
  {
    type: 'static',
    title: 'Báo cáo tĩnh',
    icon: <ClipboardList className="h-5 w-5" />,
    img: baocaoTinh,
    blend: true,
    desc: 'Snapshot cố định, không refresh',
    grad: 'from-slate-400 to-slate-600 shadow-slate-500/40',
  },
];

export function SaveReportDialog({
  fileName,
  fileType,
  htmlContent,
  sourceFilePath,
  sourceCwd,
  sessionId,
  saveAs,
  onClose,
  onSaved,
}: Props) {
  const bi = typeof window !== 'undefined' ? window.electronAPI?.bi : undefined;
  const isHtml = fileType === 'html' || fileType === 'htm';

  const [analysis, setAnalysis] = useState<SessionReportAnalysis | null>(null);
  const [selected, setSelected] = useState<BIReportType>(saveAs ? saveAs.type : 'static');
  const [title, setTitle] = useState(fileName.replace(/\.[^.]+$/, ''));
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!bi || !sessionId) return;
    void bi.analyzeSession(sessionId).then(setAnalysis);
  }, [bi, sessionId]);

  const aiReady = isHtml && !!(analysis?.prompt || htmlContent);

  // "Save as" mode: lock to the report's own type (only that card is enabled).
  // Otherwise: office/pdf files can only be saved as a static snapshot.
  const disabled = useMemo<Partial<Record<BIReportType, boolean>>>(
    () =>
      saveAs
        ? {
            ai: saveAs.type !== 'ai',
            static: saveAs.type !== 'static',
          }
        : {
            ai: !aiReady,
            static: false,
          },
    [saveAs, aiReady]
  );

  // Keep selection valid as analysis resolves.
  useEffect(() => {
    if (disabled[selected]) setSelected(saveAs ? saveAs.type : 'static');
  }, [disabled, selected, saveAs]);

  const handleSave = async () => {
    if (!bi) return;
    setSaving(true);
    try {
      const common = {
        title: title.trim() || fileName,
        description: description.trim() || null,
        sessionId,
      };
      // "Save as": duplicate the existing report under a new name (same type).
      if (saveAs) {
        await bi.duplicate(saveAs.reportId, common.title, common.description);
        onSaved();
        return;
      }
      if (selected === 'ai') {
        await bi.saveAi({
          ...common,
          htmlContent: htmlContent ?? '',
          promptTemplate: analysis?.prompt ?? '',
          queries: analysis?.queries ?? [],
        });
      } else if (selected === 'dynamic') {
        await bi.saveDynamic({
          ...common,
          htmlContent: htmlContent ?? '',
          queries: analysis?.queries ?? [],
          params: [],
        });
      } else {
        await bi.saveStatic({
          ...common,
          ...(isHtml && htmlContent
            ? { htmlContent, fileType: 'html' }
            : { sourceFilePath, sourceCwd, fileType }),
        });
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-border-muted bg-background p-6 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-text-primary">
          {saveAs ? 'Lưu báo cáo (lưu thành tên khác)' : 'Lưu Dashboard'}
        </h2>

        <div className="grid grid-cols-2 gap-3">
          {CARDS.map((c) => {
            const isDisabled = disabled[c.type];
            const active = selected === c.type;
            return (
              <button
                key={c.type}
                type="button"
                disabled={isDisabled}
                onClick={() => setSelected(c.type)}
                className={`flex flex-col items-center gap-2 rounded-2xl border p-4 text-center transition-all duration-150 hover:-translate-y-0.5 ${
                  active
                    ? 'border-accent bg-accent/5 shadow-sm'
                    : 'border-border-muted hover:border-border hover:shadow-sm'
                } ${isDisabled ? 'cursor-not-allowed opacity-40 hover:translate-y-0' : ''}`}
              >
                {c.img ? (
                  c.blend ? (
                    <img
                      src={c.img}
                      alt={c.title}
                      className="h-12 w-12 object-contain mix-blend-multiply dark:mix-blend-screen"
                    />
                  ) : (
                    <img
                      src={c.img}
                      alt={c.title}
                      className="h-12 w-12 rounded-2xl object-cover shadow-lg ring-1 ring-white/40"
                    />
                  )
                ) : (
                  <span
                    className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${c.grad} text-white shadow-lg ring-1 ring-white/40`}
                  >
                    {c.icon}
                  </span>
                )}
                <span className={`text-sm font-semibold ${active ? 'text-accent' : 'text-text-primary'}`}>
                  {c.title}
                </span>
                <span className="text-[11px] leading-tight text-text-muted">{c.desc}</span>
              </button>
            );
          })}
        </div>

        <label className="mt-4 block">
          <span className="mb-1 block text-sm text-text-secondary">Tên dashboard</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-xl border border-border-muted bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-sm text-text-secondary">Mô tả (tuỳ chọn)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Mô tả ngắn về dashboard này..."
            className="w-full resize-none rounded-xl border border-border-muted bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
          />
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-xl border border-border-muted px-4 py-2 text-sm text-text-secondary hover:bg-surface-hover"
          >
            <X className="h-4 w-4" />
            Huỷ
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  );
}
