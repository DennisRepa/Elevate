/**
 * Elevate — Gradle's version order.
 *
 * Gradle compares versions part by part, not as SemVer (specs/24, GRDVER-01 to
 * GRDVER-04; checked against Gradle itself with 24 919 pairs of strings):
 *
 *  1. A version is split into parts at ".", "-", "_" and "+" and wherever an
 *     ASCII digit meets a non-digit. A separator closes the part before it
 *     (also an empty one); the end of the string closes a part only when it
 *     is not empty, so "1." has the parts of "1".
 *  2. The parts are compared from the left until one version has none left.
 *     Equal parts are skipped.
 *  3. A numeric part is greater than a non-numeric one. Two numeric parts
 *     compare as numbers; a number above 9223372036854775807 is a string.
 *  4. Two strings: two special words (dev < rc < snapshot < final < ga <
 *     release < sp, ignoring case) end the comparison with their order. A
 *     special word other than "dev" is greater than any other string, "dev" is
 *     smaller than any other string. Two other strings compare as text,
 *     uppercase before lowercase.
 *  5. If one version has parts left over: when the first of them is numeric
 *     the longer version is greater, otherwise it is smaller.
 *
 * Some different versions are equal ("1.0-1" and "1.0.1"); the order of such
 * versions is the order in which they were reported.
 */

const MAX_LONG = 9223372036854775807n;
const SPECIAL = ['dev', 'rc', 'snapshot', 'final', 'ga', 'release', 'sp'];

interface Part {
  text: string;
  /** The value of a numeric part; `undefined` for a string. */
  value: bigint | undefined;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function makePart(text: string): Part {
  let value: bigint | undefined;
  if (text.length > 0 && [...text].every((ch) => isDigit(ch.charCodeAt(0)))) {
    const number = BigInt(text);
    if (text.length <= 18 || number <= MAX_LONG) value = number;
  }
  return { text, value };
}

function splitVersion(version: string): Part[] {
  const parts: Part[] = [];
  let start = 0;
  for (let i = 0; i < version.length; i++) {
    const ch = version[i]!;
    if (ch === '.' || ch === '-' || ch === '_' || ch === '+') {
      parts.push(makePart(version.slice(start, i)));
      start = i + 1;
    } else if (i > start && isDigit(ch.charCodeAt(0)) !== isDigit(version.charCodeAt(i - 1))) {
      parts.push(makePart(version.slice(start, i)));
      start = i;
    }
  }
  if (start < version.length) parts.push(makePart(version.slice(start)));
  return parts;
}

function specialRank(text: string): number | undefined {
  const rank = SPECIAL.indexOf(text.toLowerCase());
  return rank === -1 ? undefined : rank;
}

/** Compares two parts: a number, or `undefined` when equal and the comparison goes on. */
function compareParts(a: Part, b: Part): number | undefined {
  if (a.text === b.text) return undefined;
  if (a.value !== undefined && b.value !== undefined) {
    return a.value === b.value ? undefined : a.value > b.value ? 1 : -1;
  }
  if (a.value !== undefined) return 1;
  if (b.value !== undefined) return -1;

  const rankA = specialRank(a.text);
  const rankB = specialRank(b.text);
  if (rankA !== undefined && rankB !== undefined) return Math.sign(rankA - rankB);
  if (rankA !== undefined) return rankA === 0 ? -1 : 1;
  if (rankB !== undefined) return rankB === 0 ? 1 : -1;
  return a.text < b.text ? -1 : a.text > b.text ? 1 : undefined;
}

/** Positive when `a` is newer than `b`, negative when older, 0 when Gradle sees no difference. */
export function compareGradleVersions(a: string, b: string): number {
  const partsA = splitVersion(a);
  const partsB = splitVersion(b);
  const common = Math.min(partsA.length, partsB.length);
  for (let i = 0; i < common; i++) {
    const result = compareParts(partsA[i]!, partsB[i]!);
    if (result !== undefined) return result;
  }
  if (partsA.length === partsB.length) return 0;
  const longerIsA = partsA.length > partsB.length;
  const leftover = (longerIsA ? partsA : partsB)[common]!;
  const longerWins = leftover.value !== undefined;
  return longerIsA === longerWins ? 1 : -1;
}

/** Whether `candidate` is strictly newer than `current`. */
export function isNewerGradleVersion(candidate: string, current: string): boolean {
  return compareGradleVersions(candidate, current) > 0;
}

/**
 * Sorts versions newest first without duplicates. Versions that compare equal
 * keep the order in which they were given.
 */
export function sortGradleVersions(versions: readonly string[]): string[] {
  return [...new Set(versions)]
    .map((version, index) => ({ version, index }))
    .sort((x, y) => compareGradleVersions(y.version, x.version) || x.index - y.index)
    .map((entry) => entry.version);
}
