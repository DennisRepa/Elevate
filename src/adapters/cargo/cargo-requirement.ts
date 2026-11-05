/**
 * Elevate — Cargo version requirements.
 *
 * Cargo's syntax differs from npm's where it matters: a bare `1.2.3` means
 * `^1.2.3` (npm's `semver` reads it as exact), and `0.x` versions break at the
 * first non-zero component. Everything that touches a Cargo requirement goes
 * through this module so the `semver` package is never handed a raw Cargo string.
 */

import semver from 'semver';
import type { VersionDiff } from '../../domain/models.js';

/** One comparator, operator bare/`^`/`~`/`=`, one to three numeric components. */
const SIMPLE = /^(\^|~|=)?\s*(\d+(?:\.\d+){0,2})$/;

/** Translates a Cargo requirement into a range the `semver` package understands. */
export function toSemverRange(requirement: string): string | null {
  const parts = requirement.split(',').map((p) => p.trim());
  if (parts.some((p) => p === '')) return null;
  const converted = parts.map((part) => {
    const bare = part.match(/^\d/);
    return bare ? `^${part}` : part;
  });
  return semver.validRange(converted.join(' ')) ? converted.join(' ') : null;
}

/** Whether `version` satisfies the Cargo requirement. */
export function satisfiesRequirement(requirement: string, version: string): boolean {
  const range = toSemverRange(requirement);
  return range !== null && semver.satisfies(version, range, { includePrerelease: false });
}

/** Only a single plain comparator can be rewritten; wildcards and compound requirements are left alone. */
export function isUpgradableRequirement(requirement: string): boolean {
  return SIMPLE.test(requirement.trim());
}

/** The lowest version the requirement allows, or null if it is not a valid requirement. */
export function requirementFloor(requirement: string): string | null {
  const range = toSemverRange(requirement);
  return range ? (semver.minVersion(range)?.version ?? null) : null;
}

/**
 * Writes `target` in the style of `current`: same operator, same number of
 * components (`1` -> `2`, `1.0` -> `2.3`, `1.0.100` -> `1.0.229`). A pre-release
 * target is written in full. When the result still allows the target and equals
 * `current`, there is nothing to change.
 */
export function rewriteRequirement(current: string, target: string): string {
  const match = current.trim().match(SIMPLE);
  if (!match) return target;
  if (semver.prerelease(target)) return `${match[1] ?? ''}${target}`;
  const precision = match[2]!.split('.').length;
  const [major, minor, patch] = target.split(/[-+]/)[0]!.split('.');
  const written = [major, minor, patch].slice(0, precision).join('.');
  return `${match[1] ?? ''}${written}`;
}

/** Difference of two versions by Cargo's compatibility rule (leftmost non-zero component breaks). */
export function cargoDiff(from: string, to: string): VersionDiff {
  const a = semver.parse(from);
  const b = semver.parse(to);
  if (!a || !b) return 'minor';
  if (a.major > 0 || b.major > a.major) {
    if (b.major !== a.major) return 'major';
    return b.minor !== a.minor ? 'minor' : 'patch';
  }
  if (a.minor > 0) {
    if (b.minor !== a.minor) return 'major';
    return 'minor';
  }
  return 'major';
}
