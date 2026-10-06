/**
 * Elevate — English descriptions of scan results for CLI and MCP output.
 */

import type { SkippedDependency } from '../domain/models.js';

/** One-line explanation of why a dependency was not offered. */
export function describeSkip(skipped: SkippedDependency): string {
  const detail = skipped.detail ? ` (${skipped.detail})` : '';
  switch (skipped.reason) {
    case 'private-on-public-registry':
      return `internal package not looked up: it would be resolved from a public registry${detail}`;
    case 'lookup-failed':
      return `registry lookup failed${detail}`;
    case 'managed-externally':
      return `not editable here${detail}`;
    case 'declaration-mismatch':
      return `version location is ambiguous${detail}`;
    case 'invalid-name':
      return 'not a valid package name';
  }
}
