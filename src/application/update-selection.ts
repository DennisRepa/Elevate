/**
 * Elevate — turns update requests (CLI `--packages`, MCP `updates`) into
 * candidates, enforcing the same guardrails everywhere.
 */

import semver from 'semver';
import type { DependencyOriginKind, Ecosystem, ScanResult, UpdateCandidate, VersionDiff } from '../domain/models.js';
import { cleanJavaVersion, diffVersions, extractPreReleaseTag, isPreReleaseVersion, rangePrefix } from '../domain/versions.js';
import { describeSkip } from './describe.js';

export interface UpdateRequest {
  identifier: string;
  /** Explicit target version; defaults to the version offered by the scan. */
  targetVersion?: string;
}

/** A request that cannot be applied, with an explanation for the user. */
export class UpdateSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpdateSelectionError';
  }
}

export interface SelectionOptions {
  ecosystem: Ecosystem;
  allowMajor: boolean;
  /** Origin of an identifier; manual targets are only allowed for public packages. */
  originOf: (identifier: string) => DependencyOriginKind;
}

/** Selects all offered candidates; majors only when explicitly allowed. */
export function selectAll(scan: ScanResult, allowMajor: boolean): { selected: UpdateCandidate[]; skippedMajors: UpdateCandidate[] } {
  const selected = scan.candidates.filter((c) => allowMajor || c.diff !== 'major');
  const skippedMajors = scan.candidates.filter((c) => !allowMajor && c.diff === 'major');
  return { selected: selected.map((c) => ({ ...c, selected: true })), skippedMajors };
}

/** Resolves explicit requests against the scan result. Throws `UpdateSelectionError`. */
export function selectRequested(
  scan: ScanResult,
  requests: readonly UpdateRequest[],
  options: SelectionOptions,
): UpdateCandidate[] {
  return requests.map((request) => {
    const found = scan.candidates.find((c) => c.coordinate.identifier === request.identifier);
    if (found) return retarget(found, request.targetVersion, options);

    const skipped = scan.skipped.find((s) => s.identifier === request.identifier);
    if (skipped) {
      throw new UpdateSelectionError(`'${request.identifier}' cannot be updated: ${describeSkip(skipped)}.`);
    }
    if (!request.targetVersion) {
      throw new UpdateSelectionError(
        `'${request.identifier}' has no pending update. Specify a target version (e.g. ${request.identifier}@1.2.3).`,
      );
    }
    if (options.ecosystem === 'maven') {
      throw new UpdateSelectionError(
        `'${request.identifier}' has no pending update. Maven updates are written where the scan located the version; ` +
          'a dependency without an offered update cannot be retargeted.',
      );
    }
    if (options.originOf(request.identifier) !== 'public') {
      // A hand-picked range for a workspace or internal package could make npm
      // install a registry package with that name instead of the internal one.
      throw new UpdateSelectionError(
        `'${request.identifier}' is a workspace or internal package without a pending update; it cannot be set manually.`,
      );
    }
    return manualNpmCandidate(request.identifier, request.targetVersion, options);
  });
}

function retarget(found: UpdateCandidate, target: string | undefined, options: SelectionOptions): UpdateCandidate {
  if (!target || target === found.latest) {
    if (found.diff === 'major' && !options.allowMajor) {
      throw new UpdateSelectionError(
        `'${found.coordinate.identifier}' is a major update (${found.currentClean} ➔ ${found.latest}). Pass --allow-major / allowMajor.`,
      );
    }
    return { ...found, selected: true };
  }

  if (found.action === 'align') {
    throw new UpdateSelectionError(
      `'${found.coordinate.identifier}' is a workspace module; it can only be aligned to its local version ${found.latest}.`,
    );
  }

  // Maven updates are not resolved before verification. Accepting only versions
  // the repositories reported during the scan guarantees the target exists,
  // even when verification is skipped.
  if (options.ecosystem === 'maven' && found.availableVersions && !found.availableVersions.includes(target)) {
    throw new UpdateSelectionError(
      `'${found.coordinate.identifier}' has no version ${target} in the configured repositories. ` +
        `Available: ${found.availableVersions.slice(0, 5).join(', ')}${found.availableVersions.length > 5 ? ', …' : ''}.`,
    );
  }

  const diff = computeDiff(found.currentClean, target, options.ecosystem);
  if (diff === 'major' && !options.allowMajor) {
    throw new UpdateSelectionError(
      `'${found.coordinate.identifier}' requires a major upgrade to ${target}. Pass --allow-major / allowMajor.`,
    );
  }

  const isPreRelease = isPreReleaseVersion(target);
  return {
    ...found,
    newRange: options.ecosystem === 'npm' ? `${rangePrefix(found.currentRange)}${target}` : target,
    diff,
    selected: true,
    isCustomVersion: true,
    isPreRelease,
    preReleaseTag: isPreRelease ? extractPreReleaseTag(target) : undefined,
  };
}

function manualNpmCandidate(identifier: string, target: string, options: SelectionOptions): UpdateCandidate {
  if (!semver.valid(target)) {
    throw new UpdateSelectionError(`'${target}' is not a valid version for '${identifier}'.`);
  }
  return {
    coordinate: { identifier, artifact: identifier, ecosystem: options.ecosystem },
    currentRange: 'unknown',
    currentClean: '0.0.0',
    latest: target,
    newRange: target,
    diff: 'minor',
    scope: 'prod',
    selected: true,
    origin: { kind: 'public' },
    action: 'update',
    isCustomVersion: true,
  };
}

function computeDiff(current: string, target: string, ecosystem: Ecosystem): VersionDiff {
  const to = ecosystem === 'maven' ? cleanJavaVersion(target) : semver.valid(target);
  if (!to || !semver.valid(current)) return 'minor';
  return semver.eq(current, to) ? 'patch' : diffVersions(current, to);
}
