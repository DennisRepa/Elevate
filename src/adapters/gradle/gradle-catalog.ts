/**
 * Elevate — the version catalog `gradle/libs.versions.toml`.
 *
 * Gradle reads `gradle/libs.versions.toml` of a build as the catalog "libs".
 * Elevate reads it as TOML to match a dependency to an entry by coordinates,
 * and finds the exact text of a version with a small scanner so that an update
 * changes nothing but that text: comments, spacing, order, line endings and a
 * byte order mark stay (specs/23, GRDCAT-01 to GRDCAT-17). Other catalogs,
 * declared in the settings, are not read.
 */

import { parse } from 'smol-toml';

/** Where the catalog of a build lives, relative to the build's directory. */
export const CATALOG_FILE = 'gradle/libs.versions.toml';
/** The name Gradle gives that catalog. */
export const CATALOG_NAME = 'libs';

/** A version as the catalog writes it: plain, or rich with `require`, `strictly`, `prefer`, `reject`. */
export interface CatalogVersion {
  require?: string;
  strictly?: string;
  prefer?: string;
  reject?: string[];
}

export interface CatalogEntry {
  section: 'libraries' | 'plugins';
  /** The alias as written in the file. */
  key: string;
  /** `group` and `name` of a library. */
  group?: string;
  name?: string;
  /** The id of a plugin. */
  id?: string;
  /** The version after `version.ref` is resolved; `undefined` when the entry has none. */
  version?: CatalogVersion;
  /** The entry that holds the version text: `versions.<ref>` or `<section>.<key>`. */
  versionEntry: string;
}

export interface GradleCatalog {
  entries: CatalogEntry[];
}

type Json = Record<string, unknown>;

function isTable(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function versionOf(raw: unknown): CatalogVersion | undefined {
  if (typeof raw === 'string') return { require: raw };
  if (!isTable(raw)) return undefined;
  const reject = Array.isArray(raw.reject) ? raw.reject.filter((v): v is string => typeof v === 'string') : undefined;
  return {
    require: stringOf(raw.require),
    strictly: stringOf(raw.strictly),
    prefer: stringOf(raw.prefer),
    reject: reject ?? (typeof raw.reject === 'string' ? [raw.reject] : undefined),
  };
}

/** The version text a plain entry carries: `require`, else `strictly`, else `prefer`. */
export function catalogVersionText(version: CatalogVersion | undefined): string | undefined {
  return version?.require ?? version?.strictly ?? version?.prefer;
}

/** Whether the version has a constraint that an update must not change. */
export function catalogConstraint(version: CatalogVersion | undefined): string | undefined {
  if (!version) return undefined;
  if (version.strictly !== undefined) return `strictly '${version.strictly}'`;
  if (version.reject && version.reject.length > 0) return `reject '${version.reject.join("', '")}'`;
  if (version.prefer !== undefined && version.require === undefined) return `prefer '${version.prefer}'`;
  return undefined;
}

/**
 * Reads the entries of a catalog. `undefined` when the text is not valid TOML.
 */
export function parseCatalog(source: string): GradleCatalog | undefined {
  let doc: Json;
  try {
    doc = parse(source.replace(/^﻿/, '')) as Json;
  } catch {
    return undefined;
  }

  const versions = isTable(doc.versions) ? doc.versions : {};
  const entries: CatalogEntry[] = [];

  const resolve = (raw: unknown, section: 'libraries' | 'plugins', key: string): Pick<CatalogEntry, 'version' | 'versionEntry'> => {
    const own = { versionEntry: `${section}.${key}` };
    if (isTable(raw) && isTable(raw.version) && typeof raw.version.ref === 'string') {
      const ref = raw.version.ref;
      return { version: versionOf(versions[ref]), versionEntry: `versions.${ref}` };
    }
    return { ...own, version: versionOf(isTable(raw) ? raw.version : undefined) };
  };

  if (isTable(doc.libraries)) {
    for (const [key, raw] of Object.entries(doc.libraries)) {
      if (typeof raw === 'string') {
        const [group, name, ...rest] = raw.split(':');
        if (!group || !name) continue;
        entries.push({
          section: 'libraries', key, group, name,
          version: rest.length > 0 ? { require: rest.join(':') } : undefined,
          versionEntry: `libraries.${key}`,
        });
      } else if (isTable(raw)) {
        let group = stringOf(raw.group);
        let name = stringOf(raw.name);
        const module = stringOf(raw.module);
        if (module) [group, name] = module.split(':');
        if (!group || !name) continue;
        entries.push({ section: 'libraries', key, group, name, ...resolve(raw, 'libraries', key) });
      }
    }
  }

  if (isTable(doc.plugins)) {
    for (const [key, raw] of Object.entries(doc.plugins)) {
      if (typeof raw === 'string') {
        const at = raw.lastIndexOf(':');
        entries.push({
          section: 'plugins', key, id: at === -1 ? raw : raw.slice(0, at),
          version: at === -1 ? undefined : { require: raw.slice(at + 1) },
          versionEntry: `plugins.${key}`,
        });
      } else if (isTable(raw) && typeof raw.id === 'string') {
        entries.push({ section: 'plugins', key, id: raw.id, ...resolve(raw, 'plugins', key) });
      }
    }
  }

  return { entries };
}

/** The `[versions]` keys, for the accessor `libs.versions.<key>.get()`. */
export function catalogVersionKeys(source: string): string[] {
  try {
    const doc = parse(source.replace(/^﻿/, '')) as Json;
    return isTable(doc.versions) ? Object.keys(doc.versions) : [];
  } catch {
    return [];
  }
}

// ---- finding the text of a version ----------------------------------------------

interface Range {
  start: number;
  end: number;
}

/** The text between the quotes of the TOML string that opens at `open`. */
function stringAt(text: string, open: number): Range | undefined {
  const quote = text[open];
  if (quote !== '"' && quote !== "'") return undefined;
  for (let i = open + 1; i < text.length; i++) {
    if (quote === '"' && text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] === quote) return { start: open + 1, end: i };
  }
  return undefined;
}

/** Cuts a `#` comment off a line, respecting strings. Returns the length of the code part. */
function codeLength(line: string): number {
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (quote === '"' && ch === '\\') i++;
      else if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#') {
      return i;
    }
  }
  return line.length;
}

/**
 * The exact text of the version of a catalog entry, as offsets into `source`:
 * the string of `versions.<key>`, or of `libraries.<key>` and `plugins.<key>`
 * (the part after the last colon of `"g:a:1.0"`, the `version` string, or the
 * `require` string of a rich version).
 */
export function catalogVersionRange(source: string, entry: string): Range | undefined {
  const dot = entry.indexOf('.');
  const section = entry.slice(0, dot);
  const key = entry.slice(dot + 1);

  let currentSection: string | undefined;
  let offset = 0;
  for (const rawLine of source.split('\n')) {
    const lineStart = offset;
    offset += rawLine.length + 1;
    const line = rawLine.slice(0, codeLength(rawLine));

    const header = /^\s*\[\s*([A-Za-z0-9_.-]+)\s*\]\s*$/.exec(line.replace(/^﻿/, ''));
    if (header) {
      currentSection = header[1];
      continue;
    }
    if (currentSection !== section) continue;

    const assignment = /^﻿?\s*(?:"([^"]*)"|'([^']*)'|([A-Za-z0-9_-]+))\s*=\s*/.exec(line);
    if (!assignment || (assignment[1] ?? assignment[2] ?? assignment[3]) !== key) continue;

    const valueStart = assignment[0].length;
    const value = line.slice(valueStart);
    const inLine = (range: Range): Range => ({ start: lineStart + valueStart + range.start, end: lineStart + valueStart + range.end });

    if (value.startsWith('"') || value.startsWith("'")) {
      const text = stringAt(value, 0);
      if (!text) return undefined;
      if (section === 'versions') return inLine(text);
      const inner = value.slice(text.start, text.end);
      const colon = inner.lastIndexOf(':');
      return colon === -1 ? undefined : inLine({ start: text.start + colon + 1, end: text.end });
    }

    if (value.startsWith('{')) {
      const versionString = /\bversion\s*=\s*(["'])/.exec(value);
      if (versionString && section !== 'versions') {
        return inLine(stringAt(value, versionString.index + versionString[0].length - 1)!);
      }
      const require = /\brequire\s*=\s*(["'])/.exec(value);
      if (require) return inLine(stringAt(value, require.index + require[0].length - 1)!);
      const nested = /\bversion\s*=\s*\{[^}]*?\brequire\s*=\s*(["'])/.exec(value);
      if (nested) return inLine(stringAt(value, nested.index + nested[0].length - 1)!);
    }
    return undefined;
  }
  return undefined;
}
