/**
 * Elevate — pnpm range protocols.
 *
 * `workspace:` and `catalog:` ranges are only interpreted in pnpm
 * repositories; in an npm repository they stay non-SemVer and are ignored.
 */

export interface SplitRange {
  protocol: 'workspace' | 'catalog' | undefined;
  /** What follows `workspace:` or `catalog:`; the whole range without a protocol. */
  rest: string;
}

export function splitRangeProtocol(range: string): SplitRange {
  if (range.startsWith('workspace:')) return { protocol: 'workspace', rest: range.slice('workspace:'.length) };
  if (range.startsWith('catalog:')) return { protocol: 'catalog', rest: range.slice('catalog:'.length) };
  return { protocol: undefined, rest: range };
}
