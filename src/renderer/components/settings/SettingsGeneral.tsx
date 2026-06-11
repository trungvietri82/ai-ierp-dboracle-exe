import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen } from 'lucide-react';
import { useAppStore } from '../../store';
import { useIPC } from '../../hooks/useIPC';
import { useBranding } from '../../store/selectors';

export function SettingsGeneral() {
  const { i18n, t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const setBranding = useAppStore((s) => s.setBranding);
  const workingDir = useAppStore((s) => s.workingDir);
  const { changeWorkingDir } = useIPC();
  const [pickingFolder, setPickingFolder] = useState(false);
  const { appName, logoUrl } = useBranding();

  const pickDefaultFolder = async () => {
    setPickingFolder(true);
    try {
      // No sessionId → sets the global default folder for new chats (persisted).
      await changeWorkingDir(undefined, workingDir || undefined);
    } finally {
      setPickingFolder(false);
    }
  };
  const currentLang = i18n.language.startsWith('zh')
    ? 'zh'
    : i18n.language.startsWith('vi')
      ? 'vi'
      : 'en';
  const [appVer, setAppVer] = useState('');
  const [nameDraft, setNameDraft] = useState(appName);

  useEffect(() => {
    setNameDraft(appName);
  }, [appName]);

  useEffect(() => {
    try {
      const v = window.electronAPI?.getVersion?.();
      if (v instanceof Promise) v.then(setAppVer);
      else if (v) setAppVer(v);
    } catch {
      /* ignore */
    }
  }, []);

  const commitName = async () => {
    const next = nameDraft.trim();
    if (next === appName) return;
    try {
      const branding = await window.electronAPI.branding.setName(next);
      setBranding(branding);
    } catch (err) {
      console.error('Failed to set app name:', err);
    }
  };

  const handlePickLogo = async () => {
    try {
      const branding = await window.electronAPI.branding.pickLogo();
      setBranding(branding);
    } catch (err) {
      console.error('Failed to pick logo:', err);
    }
  };

  const handleResetLogo = async () => {
    try {
      const branding = await window.electronAPI.branding.resetLogo();
      setBranding(branding);
    } catch (err) {
      console.error('Failed to reset logo:', err);
    }
  };

  const languages = [
    { code: 'en', nativeName: 'English' },
    { code: 'zh', nativeName: 'Chinese' },
    { code: 'vi', nativeName: 'Tiếng Việt' },
  ];

  const themeOptions = [
    { value: 'light' as const, label: t('general.themeLight') },
    { value: 'dark' as const, label: t('general.themeDark') },
    { value: 'system' as const, label: t('general.themeSystem', 'System') },
  ];

  return (
    <div className="space-y-6">
      {/* Theme */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">{t('general.appearance')}</h4>
        <div className="flex gap-2">
          {themeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateSettings({ theme: opt.value })}
              className={`flex-1 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                settings.theme === opt.value
                  ? 'border-accent bg-accent/5 text-text-primary'
                  : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Language */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">{t('general.language')}</h4>
        <div className="flex gap-2">
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => i18n.changeLanguage(lang.code)}
              className={`flex-1 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                currentLang === lang.code
                  ? 'border-accent bg-accent/5 text-text-primary'
                  : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
              }`}
            >
              {lang.nativeName}
            </button>
          ))}
        </div>
      </div>

      {/* Branding */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">{t('general.branding')}</h4>
        <p className="text-xs text-text-muted">{t('general.brandingHint')}</p>

        <div className="space-y-1.5">
          <label className="block text-xs text-text-secondary">{t('general.appNameLabel')}</label>
          <input
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => void commitName()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void commitName();
              }
            }}
            placeholder="AI iERP"
            className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs text-text-secondary">{t('general.logoLabel')}</label>
          <div className="flex items-center gap-3">
            <img
              src={logoUrl}
              alt={appName}
              className="w-12 h-12 rounded-xl object-contain border border-border bg-background p-1 flex-shrink-0"
            />
            <button
              type="button"
              onClick={() => void handlePickLogo()}
              className="px-3 py-2 rounded-lg border border-border bg-surface text-sm text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
            >
              {t('general.pickLogo')}
            </button>
            <button
              type="button"
              onClick={() => void handleResetLogo()}
              className="px-3 py-2 rounded-lg text-sm text-text-muted hover:text-error hover:bg-error/10 transition-colors"
            >
              {t('general.resetLogo')}
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs text-text-secondary">Thư mục làm việc mặc định</label>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={workingDir || ''}
              placeholder="(mặc định của ứng dụng)"
              title={workingDir || ''}
              className="flex-1 min-w-0 px-3 py-2.5 rounded-lg bg-background border border-border text-text-primary text-sm truncate"
            />
            <button
              type="button"
              onClick={() => void pickDefaultFolder()}
              disabled={pickingFolder}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-surface text-sm text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors disabled:opacity-60 flex-shrink-0"
            >
              <FolderOpen className="w-4 h-4" />
              {pickingFolder ? 'Đang chọn…' : 'Chọn folder'}
            </button>
          </div>
          <p className="text-xs text-text-muted">
            Mọi cuộc trò chuyện mới sẽ mặc định dùng thư mục này.
          </p>
        </div>
      </div>

      {/* About */}
      {appVer && (
        <div className="pt-4 border-t border-border">
          <p className="text-xs text-text-muted">
            {appName} v{appVer}
          </p>
        </div>
      )}
    </div>
  );
}
