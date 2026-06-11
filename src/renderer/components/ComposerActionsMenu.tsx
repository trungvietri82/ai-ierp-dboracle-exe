import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Paperclip, SlidersHorizontal } from 'lucide-react';
import type { McpConnector } from '../hooks/useMcpConnectors';

/**
 * Compact composer "+" menu (Claude-desktop style): attach files + a per-chat
 * MCP connector list with on/off toggles + a shortcut to manage connectors.
 * Used by both the welcome composer and the in-chat composer.
 */
export function ComposerActionsMenu({
  connectors,
  disabledIds,
  onToggleServer,
  onAttachFiles,
  onManageConnectors,
  direction = 'up',
  align = 'left',
  disabled = false,
}: {
  connectors: McpConnector[];
  disabledIds: string[];
  onToggleServer: (serverId: string) => void;
  onAttachFiles?: () => void;
  onManageConnectors: () => void;
  direction?: 'up' | 'down';
  align?: 'left' | 'right';
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const disabledSet = new Set(disabledIds);

  const posClasses = [
    direction === 'up' ? 'bottom-full mb-2' : 'top-full mt-2',
    align === 'left' ? 'left-0' : 'right-0',
  ].join(' ');

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={t('composer.actionsTitle')}
        className="w-9 h-9 rounded-2xl flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors disabled:opacity-50"
      >
        <Plus className={`w-5 h-5 transition-transform ${open ? 'rotate-45' : ''}`} />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            className={`absolute ${posClasses} z-50 w-72 rounded-xl border border-border bg-surface shadow-lg py-1.5`}
          >
            {onAttachFiles && (
              <button
                type="button"
                onClick={() => {
                  onAttachFiles();
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-primary hover:bg-surface-muted transition-colors text-left"
              >
                <Paperclip className="w-4 h-4 text-text-muted flex-shrink-0" />
                {t('welcome.attachFiles')}
              </button>
            )}

            <div className="my-1 border-t border-border-subtle" />

            <div className="px-3 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-wider text-text-muted">
              {t('composer.connectors')}
            </div>
            {connectors.length === 0 ? (
              <div className="px-3 py-1.5 text-xs text-text-muted">{t('composer.noConnectors')}</div>
            ) : (
              <div className="max-h-56 overflow-y-auto">
                {connectors.map((c) => {
                  const enabled = !disabledSet.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      onClick={() => onToggleServer(c.id)}
                      className="w-full flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-surface-muted transition-colors text-left"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-text-primary truncate">{c.name}</span>
                        <span className="block text-[11px] text-text-muted">
                          {t('mcp.toolsAvailable', { count: c.toolCount })}
                        </span>
                      </span>
                      <span
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                          enabled ? 'bg-mcp' : 'bg-text-muted/30'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                            enabled ? 'translate-x-4' : 'translate-x-0.5'
                          }`}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="my-1 border-t border-border-subtle" />

            <button
              type="button"
              onClick={() => {
                onManageConnectors();
                setOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-primary hover:bg-surface-muted transition-colors text-left"
            >
              <SlidersHorizontal className="w-4 h-4 text-text-muted flex-shrink-0" />
              {t('composer.manageConnectors')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
