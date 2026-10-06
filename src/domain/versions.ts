/**
 * Elevate — version helpers shared by all ecosystems.
 */

import semver from 'semver';

/**
 * Matches a pre-release qualifier as a whole token: it must start the string,
 * follow a separator or a digit, and end at a separator, a digit or the end.
 * This keeps words such as `android`, `jre` or `devtools` from being taken for
 * pre-releases. Single-letter forms (`a1`, `b2`, `M3`) require a number.
 */
const PRE_RELEASE =
  /(?:^|[.\-_+]|(?<=\d))(alpha|beta|rc|cr|milestone|preview|snapshot|ea|dev|pre|(?:a|b|m)(?=\d))(?=$|[.\-_+]|\d)/i;

/** Whether a version is a pre-release (alpha, beta, RC, milestone, snapshot, …). */
export function isPreReleaseVersion(version: string): boolean {
  return PRE_RELEASE.test(version);
}

/** Short label for a pre-release, e.g. "BETA", "RC", "M2"; undefined for releases. */
export function extractPreReleaseTag(version: string): string | undefined {
  const match = version.match(PRE_RELEASE);
  if (!match) return undefined;
  const token = match[1]!.toLowerCase();
  if (token === 'a') return 'ALPHA';
  if (token === 'b') return 'BETA';
  if (token === 'm') {
    const number = version.slice((match.index ?? 0) + match[0].length).match(/^\d+/)?.[0];
    return `M${number ?? ''}`;
  }
  return token.toUpperCase();
}

/**
 * Normalises a Java-style version (e.g. "5.10.2", "1.71.0.Final",
 * "32.0.0-jre") to a SemVer string for diffing. Returns null when the version
 * has no numeric core.
 */
export function cleanJavaVersion(version: string): string | null {
  const match = version.match(/^v?(\d+(?:\.\d+){0,2})/);
  if (!match) return null;
  return semver.coerce(match[1])?.version ?? null;
}

/** SemVer difference between two versions, collapsed to patch/minor/major. */
export function diffVersions(from: string, to: string): 'patch' | 'minor' | 'major' {
  const kind = semver.diff(from, to);
  if (kind === 'major' || kind === 'premajor') return 'major';
  if (kind === 'minor' || kind === 'preminor') return 'minor';
  return 'patch';
}

/** Returns the range operator (`^`, `~` or none) of an npm range. */
export function rangePrefix(range: string): '^' | '~' | '' {
  if (range.startsWith('^')) return '^';
  if (range.startsWith('~')) return '~';
  return '';
}
