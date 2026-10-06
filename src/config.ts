/**
 * Elevate — configuration.
 *
 * Detects the repository root and loads an optional `elevate.config.json`
 * from it. Without a configuration file Elevate works with sensible defaults
 * in any npm workspace or Maven repository.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Locale } from './i18n/types.js';
import type { ReleaseChannel } from './domain/models.js';
import { EcosystemFactory } from './domain/ecosystem-factory.js';
import { findCheckoutBoundary } from './adapters/shared/checkout.js';
import { DEFAULT_MAVEN_PLUGINS } from './adapters/maven/maven-resolution.js';
import type { MavenPluginVersions } from './adapters/maven/maven-resolution.js';

export interface ElevateConfig {
  /** Detected repository root. */
  rootDir: string;
  /** Display name in the header (optional). */
  author?: string;
  /**
   * Internal npm scopes and Maven groupId prefixes (e.g. `@my-org`,
   * `com.mycompany`). Packages matching them are internal: they are looked
   * up only in a private registry, never on a public one.
   */
  internalScopes: string[];
  /** Optional command that replaces the default verification after an update. */
  postUpdateScript?: string;
  /** Label for the verification command in the UI. */
  postUpdateLabel?: string;
  /** Preferred language ('de' | 'en'); undefined means auto-detect. */
  locale?: Locale | 'auto';
  /** Release channel ('stable' | 'all', default 'stable'). */
  channel: ReleaseChannel;
  /** Human-readable notices about deprecated configuration keys. */
  deprecations: string[];
  /** Versions of the Maven plugins Elevate runs (always filled, defaults applied). */
  mavenPlugins: MavenPluginVersions;
  /** Human-readable notices about invalid configuration values that were replaced by defaults. */
  warnings: string[];
}

/**
 * Detects the repository root for a start directory, so Elevate behaves the
 * same wherever in the repository it is started.
 *
 * 1. The nearest `elevate.config.json` marks the root explicitly.
 * 2. Otherwise every ecosystem proposes a root and the outermost proposal wins.
 * 3. Without any marker the start directory is the root.
 *
 * The search stays inside the version-control checkout (see
 * `findCheckoutBoundary`) so markers of unrelated directories above it are
 * never picked up.
 */
export function findRepositoryRoot(startDir: string): string {
  const start = resolve(startDir);
  const boundary = findCheckoutBoundary(start);

  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'elevate.config.json'))) return dir;
    const parent = dirname(dir);
    if (dir === boundary || parent === dir) break;
    dir = parent;
  }

  const proposals = EcosystemFactory.getAvailableEcosystems()
    .map((ecosystem) => EcosystemFactory.getStrategy(ecosystem).discovery.findRoot?.(start, boundary))
    .filter((root): root is string => root !== undefined);
  // All proposals are the start directory or one of its ancestors, so the
  // outermost one has the shortest path.
  return proposals.sort((a, b) => a.length - b.length)[0] ?? start;
}

/** Thrown when `elevate.config.json` cannot be used; Elevate stops instead of ignoring it. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const NO_CONTINUE = 'Elevate does not continue without your internalScopes.';

/**
 * Reads a scope list. A missing key is fine; a key that is present but is not
 * a list of strings is an error, because ignoring it would silently switch off
 * the protection of internal packages.
 */
function stringList(file: Record<string, unknown>, key: string, source: string): string[] | undefined {
  if (!Object.hasOwn(file, key)) return undefined;
  const value = file[key];
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) return value;
  throw new ConfigError(
    `Invalid elevate.config.json (${source}): \`${key}\` must be a list of strings, ` +
      `for example ["@my-org", "com.mycompany"]. ${NO_CONTINUE}`,
  );
}

/** A plugin version is 1 to 64 characters, starts with a digit and has only letters, digits, `.` and `-`. */
const PLUGIN_VERSION = /^[0-9][A-Za-z0-9.-]{0,63}$/;

/**
 * Reads the optional `mavenPlugins` object. An invalid value is replaced by
 * the default and reported in `warnings`; unknown keys, and a `mavenPlugins`
 * that is not an object, are ignored silently.
 */
function resolveMavenPlugins(value: unknown, warnings: string[]): MavenPluginVersions {
  const plugins = { ...DEFAULT_MAVEN_PLUGINS };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return plugins;

  const given = value as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_MAVEN_PLUGINS) as (keyof MavenPluginVersions)[]) {
    if (!Object.hasOwn(given, key)) continue;
    const version = given[key];
    if (typeof version === 'string' && PLUGIN_VERSION.test(version)) {
      plugins[key] = version;
    } else {
      warnings.push(
        `\`mavenPlugins.${key}\` is not a valid version (${JSON.stringify(version)}); using the default ${DEFAULT_MAVEN_PLUGINS[key]}.`,
      );
    }
  }
  return plugins;
}

/**
 * Builds the configuration from parsed `elevate.config.json` content.
 *
 * `excludeScopes` is the former name of `internalScopes`. It is still read so
 * existing configurations keep working, and reported as deprecated.
 */
export function resolveConfig(
  rootDir: string,
  file: Record<string, unknown>,
  source = 'elevate.config.json',
): ElevateConfig {
  const deprecations: string[] = [];
  const warnings: string[] = [];
  const internal = stringList(file, 'internalScopes', source);
  const legacy = stringList(file, 'excludeScopes', source);

  if (legacy) {
    deprecations.push(
      internal
        ? '`excludeScopes` is deprecated and ignored because `internalScopes` is set; remove it from elevate.config.json.'
        : '`excludeScopes` is deprecated; rename it to `internalScopes` in elevate.config.json.',
    );
  }

  return {
    rootDir,
    author: typeof file.author === 'string' ? file.author : undefined,
    internalScopes: internal ?? legacy ?? [],
    postUpdateScript: typeof file.postUpdateScript === 'string' ? file.postUpdateScript : undefined,
    postUpdateLabel:
      typeof file.postUpdateLabel === 'string'
        ? file.postUpdateLabel
        : typeof file.postUpdateScript === 'string'
          ? file.postUpdateScript
          : undefined,
    locale: file.locale === 'de' || file.locale === 'en' ? file.locale : undefined,
    channel: file.channel === 'all' ? 'all' : 'stable',
    deprecations,
    mavenPlugins: resolveMavenPlugins(file.mavenPlugins, warnings),
    warnings,
  };
}

/**
 * Loads the configuration:
 * 1. detects the repository root (see `findRepositoryRoot`),
 * 2. reads `elevate.config.json` from it, if present,
 * 3. applies defaults for missing values.
 */
export function loadConfig(startDir: string = process.cwd()): ElevateConfig {
  const rootDir = findRepositoryRoot(startDir);
  const configPath = join(rootDir, 'elevate.config.json');
  let file: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    const unreadable = (detail: string) =>
      new ConfigError(
        `Cannot read elevate.config.json: ${detail} (${configPath}). ` +
          `Fix the file or remove it; ${NO_CONTINUE}`,
      );

    let parsed: unknown;
    try {
      // Windows editors often save JSON with a byte order mark, which JSON.parse rejects.
      parsed = JSON.parse(readFileSync(configPath, 'utf8').replace(/^﻿/, ''));
    } catch (err) {
      throw unreadable(err instanceof Error ? err.message : String(err));
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw unreadable('the file must contain a JSON object');
    }
    file = parsed as Record<string, unknown>;
  }

  return resolveConfig(rootDir, file, configPath);
}
