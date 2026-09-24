/**
 * 🪶 Elevate — i18n System
 *
 * Verwaltet Übersetzungstabellen, Spracheinstellungen und den useI18n Hook.
 */

import { useState, useCallback, useMemo } from 'react';
import type { Locale, Translations } from './types.js';
import { de } from './locales/de.js';
import { en } from './locales/en.js';

export * from './types.js';

const dictionaries: Record<Locale, Translations> = { de, en };

/** Ermittelt die Standardsprache aus Umgebung oder Config */
export function resolveInitialLocale(configured?: string): Locale {
  if (configured === 'de' || configured === 'en') return configured;

  const envLang = (process.env.LANG || process.env.LC_ALL || process.env.LANGUAGE || '').toLowerCase();
  if (envLang.startsWith('en')) return 'en';
  return 'de'; // Standard: Deutsch
}

/** Liefert das passende Wörterbuch */
export function getTranslations(locale: Locale): Translations {
  return dictionaries[locale] ?? dictionaries.de;
}

/** Hook zur Sprachverwaltung */
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
