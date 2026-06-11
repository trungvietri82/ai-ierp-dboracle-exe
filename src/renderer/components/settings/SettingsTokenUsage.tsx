import { useCallback, useEffect, useMemo, useState } from 'react';
import { Coins, RefreshCw, Search } from 'lucide-react';
import type { TokenUsageRecord } from '../../../shared/token-usage';

/**
 * Token & cost usage per question. Tokens are derived from message history;
 * cost = tokens × the user-configured price (per 1,000,000 tokens), persisted
 * in localStorage so it survives restarts.
 */
const LS = {
  inPrice: 'tokenPriceInput',
  outPrice: 'tokenPriceOutput',
  currency: 'tokenCurrency',
};

function num(key: string, fallback: number): number {
  const v = parseFloat(localStorage.getItem(key) || '');
  return Number.isFinite(v) ? v : fallback;
}

export function SettingsTokenUsage({ isActive }: { isActive: boolean }) {
  const [records, setRecords] = useState<TokenUsageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  // Prices are per 1,000,000 tokens (default = FPT DeepSeek-V4-Flash).
  const [inPrice, setInPrice] = useState(() => num(LS.inPrice, 0.14));
  const [outPrice, setOutPrice] = useState(() => num(LS.outPrice, 0.28));
  const [currency, setCurrency] = useState(() => localStorage.getItem(LS.currency) || 'USD');

  const refresh = useCallback(async () => {
    if (!window.electronAPI?.usage) return;
    setLoading(true);
    try {
      setRecords(await window.electronAPI.usage.getLog());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isActive) void refresh();
  }, [isActive, refresh]);

  useEffect(() => {
    localStorage.setItem(LS.inPrice, String(inPrice));
    localStorage.setItem(LS.outPrice, String(outPrice));
    localStorage.setItem(LS.currency, currency);
  }, [inPrice, outPrice, currency]);

  const cost = useCallback(
    (r: TokenUsageRecord) => (r.inputTokens / 1e6) * inPrice + (r.outputTokens / 1e6) * outPrice,
    [inPrice, outPrice]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) =>
      [r.question, r.model, r.createdBy, r.sessionTitle].join(' ').toLowerCase().includes(q)
    );
  }, [records, query]);

  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, r) => {
          acc.input += r.inputTokens;
          acc.output += r.outputTokens;
          acc.total += r.totalTokens;
          acc.cost += cost(r);
          return acc;
        },
        { input: 0, output: 0, total: 0, cost: 0 }
      ),
    [filtered, cost]
  );

  const fmt = (n: number) => n.toLocaleString();
  const fmtCost = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${currency}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Coins className="h-5 w-5 text-accent" />
        <h2 className="text-base font-semibold text-text-primary">Token & Chi phí theo câu hỏi</h2>
      </div>

      {/* Price config */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border-muted bg-surface p-3">
        <label className="text-xs text-text-secondary">
          Đơn giá Input / 1tr token
          <input
            type="number"
            step="0.01"
            value={inPrice}
            onChange={(e) => setInPrice(parseFloat(e.target.value) || 0)}
            className="mt-1 block w-32 rounded-lg border border-border-muted bg-background px-2 py-1 text-sm text-text-primary"
          />
        </label>
        <label className="text-xs text-text-secondary">
          Đơn giá Output / 1tr token
          <input
            type="number"
            step="0.01"
            value={outPrice}
            onChange={(e) => setOutPrice(parseFloat(e.target.value) || 0)}
            className="mt-1 block w-32 rounded-lg border border-border-muted bg-background px-2 py-1 text-sm text-text-primary"
          />
        </label>
        <label className="text-xs text-text-secondary">
          Đơn vị
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="mt-1 block w-20 rounded-lg border border-border-muted bg-background px-2 py-1 text-sm text-text-primary"
          />
        </label>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm kiếm…"
              className="w-48 rounded-lg border border-border-muted bg-background py-1.5 pl-8 pr-2 text-sm text-text-primary"
            />
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            title="Tải lại"
            className="rounded-lg p-2 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Số câu hỏi', value: fmt(filtered.length) },
          { label: 'Input tokens', value: fmt(totals.input) },
          { label: 'Output tokens', value: fmt(totals.output) },
          { label: 'Tổng chi phí', value: fmtCost(totals.cost) },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-border-muted bg-surface p-3">
            <div className="text-xs text-text-muted">{c.label}</div>
            <div className="mt-0.5 text-lg font-semibold text-text-primary">{c.value}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-border-muted">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-surface">
            <tr className="text-left text-xs uppercase tracking-wide text-text-muted">
              <th className="px-3 py-2.5">Câu hỏi</th>
              <th className="px-3 py-2.5 w-44">Ngày giờ</th>
              <th className="px-3 py-2.5 w-32">Người dùng</th>
              <th className="px-3 py-2.5 w-40">Model</th>
              <th className="px-3 py-2.5 w-24 text-right">Input</th>
              <th className="px-3 py-2.5 w-24 text-right">Output</th>
              <th className="px-3 py-2.5 w-24 text-right">Tổng</th>
              <th className="px-3 py-2.5 w-28 text-right">Chi phí</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-border-muted hover:bg-surface-hover">
                <td className="px-3 py-2.5">
                  <div className="max-w-md truncate text-text-primary" title={r.question}>
                    {r.question || '(không có nội dung)'}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-text-secondary">
                  {new Date(r.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2.5 text-text-secondary">{r.createdBy || '—'}</td>
                <td className="px-3 py-2.5 text-text-secondary">{r.model || '—'}</td>
                <td className="px-3 py-2.5 text-right text-text-secondary">{fmt(r.inputTokens)}</td>
                <td className="px-3 py-2.5 text-right text-text-secondary">{fmt(r.outputTokens)}</td>
                <td className="px-3 py-2.5 text-right font-medium text-text-primary">
                  {fmt(r.totalTokens)}
                </td>
                <td className="px-3 py-2.5 text-right text-text-primary">{fmtCost(cost(r))}</td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-text-muted">
                  Chưa có dữ liệu sử dụng token.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
