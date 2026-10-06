/**
 * Elevate — package-lock.json integrity checks.
 *
 * When a dependency's range does not include the local version of a workspace
 * package, npm does not link the workspace but installs a package with the
 * same name from the registry. That copy may come from anyone who published
 * the name. This module verifies from the lockfile that every workspace
 * dependency that should be linked actually is.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface LockEntry {
  link?: boolean;
  resolved?: string;
  version?: string;
}

interface Lockfile {
  packages?: Record<string, LockEntry>;
}

/** Reads the root package-lock.json; undefined when absent or unreadable. */
export function readLockfile(rootDir: string): Lockfile | undefined {
  const file = join(rootDir, 'package-lock.json');
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Lockfile;
  } catch {
    return undefined;
  }
}

/**
 * Returns one message per workspace dependency that is not linked.
 *
 * npm resolves a dependency of `packages/a` by looking in
 * `packages/a/node_modules` first and then in the hoisted root
 * `node_modules`, so the nearest lockfile entry decides.
 *
 * @param moduleRelPath module directory relative to the root ('' for the root)
 * @param names workspace packages the module is expected to link
 */
export function findUnlinkedWorkspaceDependencies(
  lockfile: Lockfile,
  moduleRelPath: string,
  names: readonly string[],
): string[] {
  const packages = lockfile.packages ?? {};
  const prefix = moduleRelPath ? `${moduleRelPath}/` : '';
  const violations: string[] = [];

  for (const name of names) {
    const entry = packages[`${prefix}node_modules/${name}`] ?? packages[`node_modules/${name}`];
    if (!entry) {
      violations.push(`${name}: not present in package-lock.json`);
    } else if (!entry.link) {
      const source = entry.resolved ?? 'unknown source';
      violations.push(`${name}: installed from ${source} instead of linking the workspace package`);
    }
  }
  return violations;
}
