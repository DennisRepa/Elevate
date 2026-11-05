/**
 * Elevate — pnpm-workspace.yaml.
 *
 * Reads the package patterns and catalogs of a pnpm workspace, and replaces a
 * catalog entry's range in place. The YAML document API is used for writing
 * because it keeps the position of every node: only the entry's range is
 * replaced, comments, quoting and line endings stay as they are.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMap, isScalar, parse, parseDocument } from 'yaml';
import type { Scalar } from 'yaml';

export const PNPM_WORKSPACE_FILE = 'pnpm-workspace.yaml';

export interface PnpmWorkspace {
  /** Absolute path of the file. */
  file: string;
  /** `[]` when missing or empty. */
  packages: string[];
  /** By catalog name; the default catalog is `default`. */
  catalogs: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** `catalog` and `catalogs.default` are both defined. */
  ambiguousDefaultCatalog: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function entries(value: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (isRecord(value)) {
    for (const [name, range] of Object.entries(value)) {
      if (typeof range === 'string') map.set(name, range);
    }
  }
  return map;
}

/** `undefined` when the file is absent or not valid YAML. */
export function readPnpmWorkspace(rootDir: string): PnpmWorkspace | undefined {
  const file = join(rootDir, PNPM_WORKSPACE_FILE);
  let data: unknown;
  try {
    data = parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
  if (data !== null && !isRecord(data)) return undefined;
  const doc = (data ?? {}) as Record<string, unknown>;

  const packages = Array.isArray(doc.packages) ? doc.packages.filter((p): p is string => typeof p === 'string') : [];

  const catalogs = new Map<string, Map<string, string>>();
  const named = isRecord(doc.catalogs) ? doc.catalogs : {};
  for (const [name, content] of Object.entries(named)) catalogs.set(name, entries(content));
  const hasTopLevel = isRecord(doc.catalog);
  const hasNamedDefault = isRecord(named.default);
  if (hasTopLevel) catalogs.set('default', entries(doc.catalog));

  return { file, packages, catalogs, ambiguousDefaultCatalog: hasTopLevel && hasNamedDefault };
}

/**
 * Returns `source` with the range of one catalog entry replaced. Throws when
 * the entry does not exist.
 */
export function setCatalogRange(source: string, catalog: string, name: string, newRange: string): string {
  const doc = parseDocument(source);
  const holders = catalog === 'default' ? [doc.get('catalog', true), doc.getIn(['catalogs', 'default'], true)] : [doc.getIn(['catalogs', catalog], true)];

  for (const holder of holders) {
    if (!isMap(holder)) continue;
    const node = holder.get(name, true);
    if (!isScalar(node) || !node.range) continue;
    const scalar = node as Scalar;
    const [start, end] = scalar.range!;
    const quote = scalar.type === 'QUOTE_DOUBLE' ? '"' : scalar.type === 'QUOTE_SINGLE' ? "'" : '';
    return source.slice(0, start) + quote + newRange + quote + source.slice(end);
  }
  throw new Error(`No entry for '${name}' in catalog '${catalog}' of ${PNPM_WORKSPACE_FILE}.`);
}
