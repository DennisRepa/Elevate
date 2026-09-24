/**
 * 🪶 Elevate — Konfiguration
 *
 * Erkennt automatisch das Monorepo-Root und lädt optional eine
 * `elevate.config.json` für projektspezifische Anpassungen.
 *
 * Ohne Konfigurationsdatei funktioniert Elevate universell in
 * jedem npm-Workspace-Monorepo mit sinnvollen Defaults.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Locale } from './i18n/types.js';
import type { ReleaseChannel } from './domain/models.js';

/** Projektspezifische Elevate-Konfiguration */
export interface ElevateConfig {
  /** Automatisch erkanntes Monorepo-Wurzelverzeichnis */
  rootDir: string;
  /** Anzeigename im Header (optional) */
  author?: string;
  /** npm-Scopes, die beim Scan übersprungen werden (z. B. ["@my-org"]) */
  excludeScopes: string[];
  /** Optionales Skript, das nach `npm install` ausgeführt wird */
  postUpdateScript?: string;
  /** Label für das Post-Update-Skript in der UI */
  postUpdateLabel?: string;
  /** Bevorzugte Sprache ('de' | 'en' | 'auto') */
  locale?: Locale | 'auto';
  /** Release Channel ('stable' | 'all', Standard: 'stable') */
  channel: ReleaseChannel;
}

/**
 * Sucht das nächste übergeordnete Verzeichnis, das eine package.json
 * mit einem `workspaces`-Feld enthält (→ Monorepo-Root).
 */
function findMonorepoRoot(startDir: string): string {
  let dir = resolve(startDir);

  while (true) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkg.workspaces) return dir;
      } catch {
        /* ungültige JSON ignorieren */
      }
    }

    const parent = dirname(dir);
    if (parent === dir) break; // Dateisystem-Wurzel erreicht
    dir = parent;
  }

  return startDir; // Fallback: Startverzeichnis
}

/**
 * Lädt die Elevate-Konfiguration:
 * 1. Erkennt das Monorepo-Root automatisch (aufwärts suchen)
 * 2. Liest optional `elevate.config.json` aus dem Root
 * 3. Setzt sinnvolle Defaults für fehlende Werte
 */
export function loadConfig(): ElevateConfig {
  const rootDir = findMonorepoRoot(process.cwd());

  const configPath = join(rootDir, 'elevate.config.json');
  let file: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    try {
      file = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch {
      /* ungültige JSON ignorieren */
    }
  }

  return {
    rootDir,
    author: typeof file.author === 'string' ? file.author : undefined,
    excludeScopes: Array.isArray(file.excludeScopes)
      ? (file.excludeScopes as string[])
      : [],
    postUpdateScript:
      typeof file.postUpdateScript === 'string'
        ? file.postUpdateScript
        : undefined,
    postUpdateLabel:
      typeof file.postUpdateLabel === 'string'
        ? file.postUpdateLabel
        : typeof file.postUpdateScript === 'string'
          ? file.postUpdateScript
          : undefined,
    locale:
      file.locale === 'de' || file.locale === 'en'
        ? file.locale
        : undefined,
    channel: file.channel === 'all' ? 'all' : 'stable',
  };
}
