/**
 * Elevate — Cargo.lock reader.
 *
 * Only the locked versions per crate are needed. A crate can be locked in
 * several versions at once, which makes a bare `-p name` ambiguous.
 */

import { existsSync, readFileSync } from 'node:fs';
import { getStaticTOMLValue, parseTOML } from 'toml-eslint-parser';

/** Locked versions per crate name; empty when the file is missing or unreadable. */
export function readLockedVersions(lockFile: string): Map<string, string[]> {
  const locked = new Map<string, string[]>();
  if (!existsSync(lockFile)) return locked;
  try {
    const data = getStaticTOMLValue(parseTOML(readFileSync(lockFile, 'utf8'))) as { package?: { name: string; version: string }[] };
    for (const pkg of data.package ?? []) locked.set(pkg.name, [...(locked.get(pkg.name) ?? []), pkg.version]);
  } catch {
    // An unreadable lockfile is left for cargo to complain about.
  }
  return locked;
}
