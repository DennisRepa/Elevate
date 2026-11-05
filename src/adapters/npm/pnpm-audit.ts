/**
 * Elevate — reading `pnpm audit --json`.
 */

export const AUDIT_TIMEOUT_MS = 60_000;

const LEVELS = ['info', 'low', 'moderate', 'high', 'critical'] as const;

export interface AuditSummary {
  message: string;
  severity: 'clean' | 'warn';
}

export function unavailable(reason: string): AuditSummary {
  return { message: `Vulnerability check unavailable: ${reason}.`, severity: 'warn' };
}

/** Only `metadata.vulnerabilities` decides; the exit code does not. */
export function parsePnpmAudit(output: string): AuditSummary {
  let json: any;
  try {
    json = JSON.parse(output);
  } catch {
    return unavailable('pnpm audit returned no result');
  }
  const counts = json?.metadata?.vulnerabilities;
  if (counts && typeof counts === 'object') {
    const parts: string[] = [];
    let total = 0;
    for (const level of LEVELS) {
      const n = Number(counts[level]) || 0;
      total += n;
      if (n > 0) parts.push(`${n} ${level}`);
    }
    if (total === 0) return { message: 'No known vulnerabilities found.', severity: 'clean' };
    return {
      message: `${total} ${total === 1 ? 'vulnerability' : 'vulnerabilities'} (${parts.join(', ')})`,
      severity: 'warn',
    };
  }
  const errorMessage = json?.error?.message;
  if (typeof errorMessage === 'string' && errorMessage) return unavailable(errorMessage);
  return unavailable('pnpm audit returned no result');
}
