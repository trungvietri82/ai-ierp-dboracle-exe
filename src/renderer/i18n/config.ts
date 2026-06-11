import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enTranslations from './locales/en.json';
import zhTranslations from './locales/zh.json';
import viTranslations from './locales/vi.json';

i18n
  .use(LanguageDetector) // Auto-detect browser language
  .use(initReactI18next) // Initialize react-i18next
  .init({
    resources: {
      en: {
        translation: enTranslations,
      },
      zh: {
        translation: zhTranslations,
      },
      vi: {
        translation: viTranslations,
      },
    },
    fallbackLng: 'en', // Default language
    supportedLngs: ['en', 'zh', 'vi'], // Supported languages
    interpolation: {
      escapeValue: false, // React already handles XSS
    },
    pluralSeparator: '_', // Plural separator
    contextSeparator: '_', // Context separator
    detection: {
      order: ['localStorage', 'navigator'], // Check localStorage first, then browser language
      caches: ['localStorage'], // Persist the language choice to localStorage
      lookupLocalStorage: 'i18nextLng', // localStorage key
    },
  });

export default i18n;
