import { useCallback, useEffect, useState } from 'react';
import brandIcon from '../assets/brand-icon.png';

/**
 * Blocks the whole app until a valid license is activated.
 *
 * Verification is fully offline (Ed25519) in the main process. On first launch
 * the user pastes a license key; once valid it is stored and the gate disappears.
 * A floating (shared) key works on any machine; a machine-locked key only works
 * on the machine whose id is shown here.
 */
type LicenseStatus = {
  valid: boolean;
  reason?: string;
  machineId: string;
  payload?: { sub: string; exp: number | null; mid: string | null };
};

export function LicenseGate({ children }: { children: React.ReactNode }) {
  const api = typeof window !== 'undefined' ? window.electronAPI?.license : undefined;
  const [loading, setLoading] = useState(true);
  const [valid, setValid] = useState(false);
  const [reason, setReason] = useState<string | undefined>();
  const [machineId, setMachineId] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [activating, setActivating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Browser/non-electron preview: do not block.
      if (!api) {
        if (!cancelled) {
          setValid(true);
          setLoading(false);
        }
        return;
      }
      try {
        const s = (await api.status()) as LicenseStatus;
        if (!cancelled) {
          setValid(s.valid);
          setReason(s.valid ? undefined : s.reason);
          setMachineId(s.machineId || '');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const handleActivate = useCallback(async () => {
    if (!api || !keyInput.trim()) return;
    setActivating(true);
    setReason(undefined);
    try {
      const s = (await api.activate(keyInput.trim())) as LicenseStatus;
      setValid(s.valid);
      setMachineId(s.machineId || machineId);
      if (!s.valid) setReason(s.reason || 'License không hợp lệ');
    } catch {
      setReason('Lỗi khi kích hoạt license');
    } finally {
      setActivating(false);
    }
  }, [api, keyInput, machineId]);

  const copyMachineId = useCallback(() => {
    if (!machineId) return;
    void navigator.clipboard?.writeText(machineId).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }, [machineId]);

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-text-secondary">
        Đang kiểm tra license…
      </div>
    );
  }

  if (valid) return <>{children}</>;

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-3xl border border-border-muted bg-surface p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src={brandIcon} alt="iERP" className="mb-4 h-16 w-16 object-contain" />
          <h1 className="text-xl font-semibold text-text-primary">Kích hoạt AI iERP</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Nhập license key để bắt đầu sử dụng ứng dụng.
          </p>
        </div>

        <textarea
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder="Dán license key vào đây…"
          rows={4}
          className="w-full resize-none rounded-2xl border border-border-muted bg-background px-4 py-3 text-sm text-text-primary outline-none focus:border-accent"
        />

        {reason && <p className="mt-3 text-sm text-red-500">{reason}</p>}

        <button
          type="button"
          onClick={handleActivate}
          disabled={activating || !keyInput.trim()}
          className="mt-4 w-full rounded-2xl bg-accent py-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {activating ? 'Đang kích hoạt…' : 'Kích hoạt'}
        </button>

        <div className="mt-6 border-t border-border-muted pt-4">
          <p className="text-xs text-text-secondary">
            Mã máy của bạn (gửi cho nhà cung cấp nếu cần cấp key khóa theo máy):
          </p>
          <button
            type="button"
            onClick={copyMachineId}
            title="Bấm để copy"
            className="mt-1 w-full truncate rounded-xl bg-background px-3 py-2 text-left font-mono text-xs text-text-primary hover:bg-surface-hover"
          >
            {machineId || '—'} {copied ? '✓ đã copy' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
