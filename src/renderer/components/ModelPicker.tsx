import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Check, RefreshCw, Search, Loader2 } from 'lucide-react';
import { useAppConfig } from '../store/selectors';
import { useAppStore } from '../store';
import type { ProviderModelInfo } from '../types';

const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI);

interface ModelPickerProps {
  /** Horizontal alignment of the dropdown panel relative to the trigger. */
  align?: 'left' | 'right';
  className?: string;
}

/**
 * Compact in-chat model selector. Reads the active model from the app config,
 * fetches the available models for the active provider, and switches the active
 * config set's model via `config.save`. Sits in the chat input action bars
 * (WelcomeView + ChatView).
 */
export function ModelPicker({ align = 'left', className = '' }: ModelPickerProps) {
  const { t } = useTranslation();
  const appConfig = useAppConfig();
  const setAppConfig = useAppStore((s) => s.setAppConfig);

  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ProviderModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasFetchedRef = useRef(false);

  const currentModel = appConfig?.model || '';

  const fetchModels = useCallback(async () => {
    if (!isElectron || !appConfig) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.config.listModels({
        provider: appConfig.provider,
        apiKey: appConfig.apiKey || '',
        baseUrl: appConfig.baseUrl || undefined,
      });
      setModels(result);
      hasFetchedRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, [appConfig]);

  // Fetch the model list the first time the dropdown is opened.
  useEffect(() => {
    if (open && !hasFetchedRef.current && !loading) {
      void fetchModels();
    }
  }, [open, loading, fetchModels]);

  // Re-fetch when the provider / base URL / key changes (so the list stays in sync).
  useEffect(() => {
    hasFetchedRef.current = false;
    setModels([]);
  }, [appConfig?.provider, appConfig?.baseUrl, appConfig?.apiKey]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const applyModel = useCallback(
    async (modelId: string) => {
      const next = modelId.trim();
      if (!next || !isElectron || saving) {
        return;
      }
      setSaving(true);
      try {
        const res = await window.electronAPI.config.save({ model: next });
        if (res?.success && res.config) {
          setAppConfig(res.config);
        }
        setOpen(false);
        setQuery('');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [saving, setAppConfig]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => m.id.toLowerCase().includes(q));
  }, [models, query]);

  // Allow typing a model id that isn't in the fetched list (manual entry).
  const trimmedQuery = query.trim();
  const showCustomOption =
    trimmedQuery.length > 0 && !models.some((m) => m.id.toLowerCase() === trimmedQuery.toLowerCase());

  if (!appConfig) {
    return null;
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t('chat.modelPicker.selectModel')}
        className="inline-flex items-center gap-1 max-w-[200px] px-2.5 py-1 rounded-full border border-border-subtle bg-background/60 text-xs text-text-muted hover:text-text-primary hover:border-border transition-colors"
      >
        <span className="truncate">{currentModel || t('chat.noModel')}</span>
        <ChevronDown className="w-3 h-3 flex-shrink-0" />
      </button>

      {open && (
        <div
          className={`absolute bottom-full mb-2 z-50 w-72 max-w-[80vw] rounded-xl border border-border bg-background shadow-soft overflow-hidden ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {/* Search / manual entry */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border-muted">
            <Search className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && trimmedQuery) {
                  e.preventDefault();
                  void applyModel(trimmedQuery);
                }
              }}
              placeholder={t('chat.modelPicker.searchModels')}
              className="flex-1 bg-transparent border-none outline-none text-sm text-text-primary placeholder:text-text-muted"
            />
            <button
              type="button"
              onClick={() => void fetchModels()}
              disabled={loading}
              title={t('chat.modelPicker.refresh')}
              className="text-text-muted hover:text-text-primary disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* List */}
          <div className="max-h-64 overflow-y-auto py-1">
            {loading && (
              <div className="flex items-center gap-2 px-3 py-3 text-xs text-text-muted">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {t('chat.modelPicker.loadingModels')}
              </div>
            )}

            {!loading && error && (
              <div className="px-3 py-2 text-xs text-error break-words">
                {t('chat.modelPicker.loadFailed')}
                <div className="mt-1 text-text-muted">{error}</div>
              </div>
            )}

            {!loading &&
              filtered.map((m) => {
                const isCurrent = m.id === currentModel;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => void applyModel(m.id)}
                    disabled={saving}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-hover disabled:opacity-50 ${
                      isCurrent ? 'text-accent' : 'text-text-primary'
                    }`}
                  >
                    <span className="truncate">{m.name}</span>
                    {isCurrent && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                  </button>
                );
              })}

            {!loading && !error && filtered.length === 0 && !showCustomOption && (
              <div className="px-3 py-3 text-xs text-text-muted">
                {t('chat.modelPicker.noModelsFound')}
              </div>
            )}

            {!loading && showCustomOption && (
              <button
                type="button"
                onClick={() => void applyModel(trimmedQuery)}
                disabled={saving}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface-hover disabled:opacity-50 transition-colors border-t border-border-muted"
              >
                {t('chat.modelPicker.useCustomModel', { model: trimmedQuery })}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
