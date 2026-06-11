/**
 * @module main/config/branding-store
 *
 * Disk-persisted white-label branding: the app display name and an optional
 * custom logo (stored as a data URL). Lets the user rebrand the app (name +
 * logo) from Settings without code changes.
 *
 * Defaults target the iERP rollout (name "AI iERP", bundled iERP logo asset),
 * but everything is overridable and resettable from the UI.
 */
import Store, { type Options as StoreOptions } from 'electron-store';

export const DEFAULT_APP_NAME = 'AI iERP';

export interface Branding {
  /** Display name shown across the UI. Empty → DEFAULT_APP_NAME. */
  appName: string;
  /** Custom logo as a data URL (data:image/...;base64,...). Empty → bundled default logo. */
  logoDataUrl: string;
}

interface BrandingSchema {
  appName: string;
  logoDataUrl: string;
}

const store = new Store<BrandingSchema>({
  projectName: 'ai-ierp',
  name: 'branding',
  defaults: { appName: '', logoDataUrl: '' },
} as StoreOptions<BrandingSchema> & { projectName?: string });

/** Current branding with defaults applied. */
export function getBranding(): Branding {
  const appNameRaw = store.get('appName', '');
  const logoRaw = store.get('logoDataUrl', '');
  return {
    appName: typeof appNameRaw === 'string' && appNameRaw.trim() ? appNameRaw.trim() : DEFAULT_APP_NAME,
    logoDataUrl: typeof logoRaw === 'string' ? logoRaw : '',
  };
}

/** Set the display name. Empty/blank resets to the default name. */
export function setAppName(name: string): Branding {
  store.set('appName', typeof name === 'string' ? name.trim() : '');
  return getBranding();
}

/** Set a custom logo (data URL). Empty string clears it (revert to default). */
export function setLogoDataUrl(dataUrl: string): Branding {
  store.set('logoDataUrl', typeof dataUrl === 'string' ? dataUrl : '');
  return getBranding();
}

/** Revert the logo to the bundled default. */
export function clearLogo(): Branding {
  store.set('logoDataUrl', '');
  return getBranding();
}
