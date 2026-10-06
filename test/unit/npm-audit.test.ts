import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `npm install` is replaced by a test double that prints what the scenario says npm printed.
const process_ = vi.hoisted(() => ({ runCommand: vi.fn() }));
vi.mock('../../src/adapters/shared/process.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/adapters/shared/process.js')>()),
  runCommand: process_.runCommand,
}));

import { NpmUpdaterAdapter, parseAuditSummary } from '../../src/adapters/npm/npm-updater.js';
import { cleanupTemp, makeTree, npmCandidate, npmModule } from '../helpers.js';

beforeEach(() => process_.runCommand.mockReset());
afterEach(cleanupTemp);

const CLEAN = { message: 'No known vulnerabilities found.', severity: 'clean' };

/** Applies an update while `npm install` prints the given output, and returns the outcome. */
async function updateWithNpmOutput(streams: { stdout?: string; stderr?: string }) {
  process_.runCommand.mockResolvedValue({ exitCode: 0, stdout: streams.stdout ?? '', stderr: streams.stderr ?? '', timedOut: false });
  const root = makeTree({ 'package.json': '{"name": "m", "version": "1.0.0", "dependencies": {"a": "^1.0.0"}}' });
  return new NpmUpdaterAdapter().applyUpdates(npmModule(root), root, [npmCandidate('a', '^1.0.0', '^1.1.0')], () => {});
}

describe('zero vulnerabilities is a clean result', () => {
  it('AUDIT-01 npm reports no vulnerabilities', () => {
    expect(parseAuditSummary('added 1 package, and audited 2 packages in 1s\n\nfound 0 vulnerabilities\n')).toEqual(CLEAN);
  });

  it('AUDIT-05 npm prints no summary at all', () => {
    expect(parseAuditSummary('up to date in 400ms\n')).toEqual(CLEAN);
  });
});

describe('one or more vulnerabilities is a warning that quotes the line', () => {
  it.each([
    '1 high severity vulnerability',
    '2 moderate severity vulnerabilities',
    '3 info severity vulnerabilities',
    '1 critical severity vulnerability',
    '5 vulnerabilities (1 low, 2 moderate, 2 high)',
    'found 3 vulnerabilities (1 low, 2 high)',
  ])('AUDIT-02 npm reports vulnerabilities: %s', (line) => {
    const output = `added 12 packages, and audited 13 packages in 2s\n\n${line}\n\nTo address all issues, run:\n  npm audit fix\n`;
    expect(parseAuditSummary(output)).toEqual({ message: line, severity: 'warn' });
  });

  it('AUDIT-03 The summary is found in either output stream and with Windows line endings', async () => {
    const outcome = await updateWithNpmOutput({ stderr: 'added 1 package\r\n\r\n2 high severity vulnerabilities\r\n' });
    expect(outcome.auditSeverity).toBe('warn');
    expect(outcome.auditMessage).toBe('2 high severity vulnerabilities');
  });

  it('AUDIT-04 Other numbers in the output are not mistaken for a count', async () => {
    const outcome = await updateWithNpmOutput({
      stdout:
        'added 310 packages, and audited 311 packages in 9s\n\n42 packages are looking for funding\n  run `npm fund` for details\n\nfound 0 vulnerabilities\n',
    });
    expect(outcome.auditSeverity).toBe('clean');
    expect(outcome.auditMessage).toBe('No known vulnerabilities found.');
    expect(outcome.fundingMessage).toBe('42 packages are looking for funding');
  });
});
