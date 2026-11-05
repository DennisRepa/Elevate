/**
 * Elevate — per-ecosystem version rules.
 *
 * Collects what differs between ecosystems when a target version is chosen, so
 * callers ask the strategy instead of testing the ecosystem name.
 */

import semver from 'semver';
import type { VersionDiff } from './models.js';
import { cleanJavaVersion, diffVersions, rangePrefix } from './versions.js';

export interface VersionPolicy {
  /** A version in comparable SemVer form, or null when it has no numeric core. */
  normalize(version: string): string | null;
  /** The text to write for `target`, given the requirement currently in the manifest. */
  rewrite(currentRange: string, target: string): string;
  /** Size of the change from `current` (normalised) to `target` (raw). */
  diff(current: string, target: string): VersionDiff;
  /** Whether a dependency without a pending update may be set to a version by hand. */
  readonly allowsManualTargets: boolean;
}

/** Diff using SemVer; an unreadable side counts as `minor`. */
export function semverDiff(current: string, target: string, normalize: (v: string) => string | null): VersionDiff {
  const to = normalize(target);
  if (!to || !semver.valid(current)) return 'minor';
  return semver.eq(current, to) ? 'patch' : diffVersions(current, to);
}

export const npmVersionPolicy: VersionPolicy = {
  normalize: (v) => semver.valid(v),
  rewrite: (current, target) => `${rangePrefix(current)}${target}`,
  diff: (current, target) => semverDiff(current, target, (v) => semver.valid(v)),
  allowsManualTargets: true,
};

export const mavenVersionPolicy: VersionPolicy = {
  normalize: cleanJavaVersion,
  rewrite: (_current, target) => target,
  diff: (current, target) => semverDiff(current, target, cleanJavaVersion),
  allowsManualTargets: false,
};
