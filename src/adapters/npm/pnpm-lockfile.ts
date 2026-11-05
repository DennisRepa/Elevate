/**
 * Elevate — pnpm-lock.yaml integrity checks.
 *
 * pnpm links a workspace package only for a dependency written with the
 * `workspace:` protocol. After an update that aligned such dependencies, the
 * `importers` section of the lockfile (lockfileVersion 9.x, pnpm 9 to 12)
 * proves that they are linked and not installed from a registry.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

export interface PnpmImporterEntry {
  specifier: string;
  version: string;
}

export type PnpmImporters = Record<string, Record<string, Record<string, PnpmImporterEntry>>>;

export type PnpmLockfile =
  | { kind: 'ok'; importers: PnpmImporters }
  | { kind: 'missing' }
  | { kind: 'unreadable' }
  | { kind: 'unsupported'; lockfileVersion: string };

const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

export function readPnpmLockfile(rootDir: string): PnpmLockfile {
  const file = join(rootDir, 'pnpm-lock.yaml');
  if (!existsSync(file)) return { kind: 'missing' };
  let data: any;
  try {
    data = parse(readFileSync(file, 'utf8'));
  } catch {
    return { kind: 'unreadable' };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { kind: 'unreadable' };

  const lockfileVersion = String(data.lockfileVersion ?? '');
  if (!/^9(\.|$)/.test(lockfileVersion)) return { kind: 'unsupported', lockfileVersion };
  const importers = data.importers ?? {};
  if (typeof importers !== 'object' || Array.isArray(importers)) return { kind: 'unreadable' };
  return { kind: 'ok', importers: importers as PnpmImporters };
}

/**
 * One message per aligned dependency that is not linked.
 *
 * @param moduleRelPath module directory relative to the root ('' for the root)
 */
export function findUnlinkedPnpmDependencies(
  lockfile: PnpmLockfile,
  moduleRelPath: string,
  names: readonly string[],
): string[] {
  switch (lockfile.kind) {
    case 'missing':
      return ['pnpm-lock.yaml is missing; workspace links cannot be verified'];
    case 'unreadable':
      return ['pnpm-lock.yaml could not be read; workspace links cannot be verified'];
    case 'unsupported':
      return [
        `pnpm-lock.yaml has lockfileVersion '${lockfile.lockfileVersion}', which Elevate cannot read; workspace links cannot be verified`,
      ];
  }

  const importer = lockfile.importers[moduleRelPath === '' ? '.' : moduleRelPath] ?? {};
  const violations: string[] = [];
  for (const name of names) {
    let entry: PnpmImporterEntry | undefined;
    for (const section of SECTIONS) {
      entry = importer[section]?.[name];
      if (entry) break;
    }
    if (!entry) violations.push(`${name}: not present in pnpm-lock.yaml`);
    else if (!String(entry.version).startsWith('link:')) {
      violations.push(`${name}: resolved to ${entry.version} instead of linking the workspace package`);
    }
  }
  return violations;
}
