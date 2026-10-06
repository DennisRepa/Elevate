/**
 * 🪶 Elevate — i18n System
 *
 * Translation tables, language detection and the useI18n hook.
 */

import { useState, useCallback, useMemo } from 'react';
import type { Locale, Translations } from './types.js';
import { de } from './locales/de.js';
import { en } from './locales/en.js';

export * from './types.js';

const dictionaries: Record<Locale, Translations> = { de, en };

/** Determines the initial language from the configuration or the environment. */
export function resolveInitialLocale(configured?: string): Locale {
  if (configured === 'de' || configured === 'en') return configured;

  const envLang = (process.env.LANG || process.env.LC_ALL || process.env.LANGUAGE || '').toLowerCase();
  if (envLang.startsWith('en')) return 'en';
  return 'de'; // Standard: Deutsch
}

/** Returns the translation table for a locale. */
export function getTranslations(locale: Locale): Translations {
  return dictionaries[locale] ?? dictionaries.de;
}

/** Hook that manages the active language. */
export function useI18n(initialLocale: Locale = 'de') {
  const [locale, setLocale] = useState<Locale>(initialLocale);

  const toggleLocale = useCallback(() => {
    setLocale((prev) => (prev === 'de' ? 'en' : 'de'));
  }, []);

  const t = useMemo(() => getTranslations(locale), [locale]);

  return {
    locale,
    setLocale,
    toggleLocale,
    t,
  } as const;
}
