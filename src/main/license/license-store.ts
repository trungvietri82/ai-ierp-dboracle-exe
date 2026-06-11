/**
 * @module main/license/license-store
 *
 * Persists the activated license key (electron-store, obfuscated at rest).
 */
import Store, { type Options as StoreOptions } from 'electron-store';

interface LicenseSchema {
  key: string;
}

const store = new Store<LicenseSchema>({
  projectName: 'ai-ierp',
  name: 'license',
  encryptionKey: 'ai-ierp-license-v1',
  defaults: { key: '' },
} as StoreOptions<LicenseSchema> & { projectName?: string });

export function getStoredLicenseKey(): string {
  return (store.get('key', '') as string) || '';
}

export function setStoredLicenseKey(key: string): void {
  store.set('key', key.trim());
}

export function clearStoredLicenseKey(): void {
  store.delete('key');
}
