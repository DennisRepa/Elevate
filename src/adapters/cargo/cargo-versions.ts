/**
 * Elevate — chooses the version to offer from a crate's index entries.
 */

import semver from 'semver';
import type { ReleaseChannel } from '../../domain/models.js';
import type { IndexVersion } from './cargo-index.js';

export interface Selection {
  version: string | undefined;
  /** The newest candidate that was passed over because it needs a newer rustc than the project declares. */
  blockedByMsrv?: { version: string; requires: string };
}

const rust = (v: string) => semver.coerce(v)?.version;

export function selectVersion(
  versions: readonly IndexVersion[],
  options: { channel: ReleaseChannel; rustVersion?: string },
): Selection {
  const candidates = versions
    .filter((v) => !v.yanked && semver.valid(v.version))
    .filter((v) => options.channel === 'all' || semver.prerelease(v.version) === null)
    .sort((a, b) => semver.rcompare(a.version, b.version));

  const project = options.rustVersion ? rust(options.rustVersion) : undefined;
  let blocked: Selection['blockedByMsrv'];
  for (const candidate of candidates) {
    const needs = candidate.rustVersion ? rust(candidate.rustVersion) : undefined;
    if (project && needs && semver.gt(needs, project)) {
      blocked ??= { version: candidate.version, requires: candidate.rustVersion! };
      continue;
    }
    return { version: candidate.version, ...(blocked ? { blockedByMsrv: blocked } : {}) };
  }
  return { version: undefined, ...(blocked ? { blockedByMsrv: blocked } : {}) };
}
