import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runUpdateWorkflow } from '../../src/application/update-workflow.js';
import { UpdateSelectionError, selectAll, selectRequested } from '../../src/application/update-selection.js';
import { PublicLookupRefusedError, lookupVersions } from '../../src/application/version-lookup.js';
import { FileSnapshot } from '../../src/adapters/shared/file-snapshot.js';
import { InstallError } from '../../src/domain/ports.js';
import type { ApplyOutcome, DependencyUpdaterPort, VerificationPort, VerificationResult } from '../../src/domain/ports.js';
import type { EcosystemStrategy } from '../../src/domain/ecosystem-strategy.js';
import type { ProjectModule, ScanResult, UpdateCandidate } from '../../src/domain/models.js';
import { cleanupTemp, makeTree } from '../helpers.js';

afterEach(cleanupTemp);

const candidate = (identifier: string, overrides: Partial<UpdateCandidate> = {}): UpdateCandidate => ({
  coordinate: { identifier, artifact: identifier, ecosystem: 'npm' },
  currentRange: '^1.0.0',
  currentClean: '1.0.0',
  latest: '1.2.0',
  newRange: '^1.2.0',
  diff: 'minor',
  scope: 'prod',
  selected: true,
  origin: { kind: 'public' },
  action: 'update',
  ...overrides,
});

describe('FileSnapshot', () => {
  it('restores modified files and removes files that did not exist', () => {
    const root = makeTree({ 'a.json': 'original' });
    const snapshot = FileSnapshot.capture([join(root, 'a.json'), join(root, 'new.json')]);
    writeFileSync(join(root, 'a.json'), 'changed');
    writeFileSync(join(root, 'new.json'), 'created');
    expect(snapshot.changedFiles()).toHaveLength(2);

    snapshot.restore();
    expect(readFileSync(join(root, 'a.json'), 'utf8')).toBe('original');
    expect(existsSync(join(root, 'new.json'))).toBe(false);
    expect(snapshot.changedFiles()).toEqual([]);
  });
});

describe('runUpdateWorkflow', () => {
  type Behaviour = {
    apply?: 'ok' | 'throw' | 'violation';
    /** Result before the update (default: clean). */
    baseline?: VerificationResult['status'];
    /** Result after the update; 'throw' simulates a crashing verifier. */
    verify?: VerificationResult['status'] | 'throw';
  };

  function setup(behaviour: Behaviour) {
    const root = makeTree({ 'package.json': '{"v":1}' });
    const manifest = join(root, 'package.json');
    const calls: string[] = [];

    const updater: DependencyUpdaterPort = {
      affectedFiles: () => [manifest],
      async applyUpdates(): Promise<ApplyOutcome> {
        calls.push('apply');
        writeFileSync(manifest, '{"v":2}');
        if (behaviour.apply === 'throw') throw new InstallError('npm install failed', 'E404');
        return {
          updatedCount: 1,
          auditMessage: 'ok',
          auditSeverity: 'clean',
          integrityViolations: behaviour.apply === 'violation' ? ['@acme/core: installed from registry'] : [],
        };
      },
      async resync() {
        calls.push('resync');
      },
    };
    const verifier: VerificationPort = {
      async verify(_module, _root, options) {
        const before = !calls.includes('apply');
        calls.push(`${before ? 'baseline' : 'verify'}:${options?.changedFiles?.length ?? 0}`);
        const status = before ? (behaviour.baseline ?? 'clean') : (behaviour.verify ?? 'clean');
        if (status === 'throw') throw new Error('spawn mvn ENOENT');
        return { status, details: 'details', label: 'check' };
      },
    };
    const strategy = { updater, verifier } as unknown as EcosystemStrategy;
    const module = { path: root } as ProjectModule;
    return { root, manifest, calls, run: (options = {}) => runUpdateWorkflow(strategy, module, root, [candidate('x')], options) };
  }

  it('keeps successful updates and reports the changed files', async () => {
    const { manifest, calls, run } = setup({ apply: 'ok' });
    const summary = await run();
    expect(summary).toMatchObject({ verificationStatus: 'clean', changedFiles: ['package.json'] });
    expect(summary.rolledBack).toBeUndefined();
    expect(readFileSync(manifest, 'utf8')).toBe('{"v":2}');
    expect(calls).toEqual(['baseline:1', 'apply', 'verify:1']);
  });

  it('rolls back when installation fails', async () => {
    const { manifest, calls, run } = setup({ apply: 'throw' });
    const summary = await run();
    expect(summary.rolledBack).toBe(true);
    expect(summary.failure).toContain('npm install failed');
    expect(summary.failure).toContain('E404');
    expect(readFileSync(manifest, 'utf8')).toBe('{"v":1}');
    expect(calls).toEqual(['baseline:1', 'apply', 'resync']);
  });

  it('rolls back on integrity violations, even when verification would pass', async () => {
    const { manifest, run } = setup({ apply: 'violation' });
    const summary = await run({ keepOnFailure: true });
    expect(summary.rolledBack).toBe(true);
    expect(summary.failure).toContain('@acme/core: installed from registry');
    expect(readFileSync(manifest, 'utf8')).toBe('{"v":1}');
  });

  it('rolls back when verification fails', async () => {
    const { manifest, run } = setup({ apply: 'ok', verify: 'warn' });
    const summary = await run();
    expect(summary).toMatchObject({ rolledBack: true, updatedCount: 0, verificationStatus: 'warn' });
    expect(readFileSync(manifest, 'utf8')).toBe('{"v":1}');
  });

  it('keeps a failed verification for investigation when asked to', async () => {
    const { manifest, run } = setup({ apply: 'ok', verify: 'warn' });
    const summary = await run({ keepOnFailure: true });
    expect(summary.rolledBack).toBeUndefined();
    expect(readFileSync(manifest, 'utf8')).toBe('{"v":2}');
  });

  it('rolls back when the verifier itself crashes', async () => {
    const { manifest, run } = setup({ apply: 'ok', verify: 'throw' });
    const summary = await run();
    expect(summary).toMatchObject({ rolledBack: true, verificationStatus: 'warn' });
    expect(summary.verificationDetails).toContain('ENOENT');
    expect(readFileSync(manifest, 'utf8')).toBe('{"v":1}');
  });

  it('keeps the update when verification already failed before it', async () => {
    const { manifest, run } = setup({ apply: 'ok', baseline: 'warn', verify: 'warn' });
    const summary = await run();
    expect(summary.rolledBack).toBeUndefined();
    expect(summary.verificationDetails).toMatch(/already failed before the update/);
    expect(readFileSync(manifest, 'utf8')).toBe('{"v":2}');
  });

  it('skips verification on request', async () => {
    const { calls, run } = setup({ apply: 'ok' });
    await run({ skipVerification: true });
    expect(calls).toEqual(['apply']);
  });
});

describe('update selection', () => {
  const scan: ScanResult = {
    candidates: [
      candidate('chalk'),
      candidate('react', { diff: 'major', latest: '19.0.0', newRange: '^19.0.0', currentClean: '18.0.0', currentRange: '^18.0.0' }),
      candidate('@acme/core', {
        action: 'align',
        origin: { kind: 'workspace', moduleId: '@acme/core', moduleRelPath: 'packages/core' },
        latest: '2.0.0',
      }),
    ],
    skipped: [{ identifier: '@acme/secret', origin: 'private', reason: 'private-on-public-registry' }],
  };
  const options = { ecosystem: 'npm' as const, allowMajor: false, originOf: () => 'public' as const };

  it('selects all but majors unless allowed', () => {
    expect(selectAll(scan, false).selected.map((c) => c.coordinate.identifier)).toEqual(['chalk', '@acme/core']);
    expect(selectAll(scan, true).selected).toHaveLength(3);
  });

  it('retargets a candidate and recomputes the diff', () => {
    const [chalk] = selectRequested(scan, [{ identifier: 'chalk', targetVersion: '1.1.0' }], options);
    expect(chalk).toMatchObject({ newRange: '^1.1.0', diff: 'minor', isCustomVersion: true });
  });

  it('enforces the major guardrail', () => {
    expect(() => selectRequested(scan, [{ identifier: 'react' }], options)).toThrow(/--allow-major/);
    expect(() => selectRequested(scan, [{ identifier: 'chalk', targetVersion: '2.0.0' }], options)).toThrow(/major/);
  });

  it('only aligns workspace modules to their local version', () => {
    expect(() => selectRequested(scan, [{ identifier: '@acme/core', targetVersion: '3.0.0' }], options)).toThrow(
      /can only be aligned/,
    );
  });

  it('explains why a skipped dependency cannot be updated', () => {
    expect(() => selectRequested(scan, [{ identifier: '@acme/secret', targetVersion: '1.0.0' }], options)).toThrow(
      /public registry/,
    );
  });

  it('refuses manual targets for workspace or internal packages', () => {
    const strict = { ...options, originOf: () => 'private' as const };
    expect(() => selectRequested(scan, [{ identifier: '@acme/other', targetVersion: '1.0.0' }], strict)).toThrow(
      UpdateSelectionError,
    );
  });

  it('accepts only Maven versions the repositories reported', () => {
    const maven: ScanResult = {
      candidates: [
        {
          ...candidate('g:a', { latest: '1.2.0', newRange: '1.2.0', currentRange: '1.0.0' }),
          coordinate: { identifier: 'g:a', group: 'g', artifact: 'a', ecosystem: 'maven' },
          availableVersions: ['1.2.0', '1.1.0', '1.0.0'],
        },
      ],
      skipped: [],
    };
    const mavenOptions = { ...options, ecosystem: 'maven' as const };
    expect(selectRequested(maven, [{ identifier: 'g:a', targetVersion: '1.1.0' }], mavenOptions)[0]).toMatchObject({
      newRange: '1.1.0',
    });
    expect(() => selectRequested(maven, [{ identifier: 'g:a', targetVersion: '1.1.5' }], mavenOptions)).toThrow(
      /no version 1.1.5/,
    );
  });

  it('allows manual targets for public npm packages', () => {
    const [left] = selectRequested(scan, [{ identifier: 'left-pad', targetVersion: '1.3.0' }], options);
    expect(left).toMatchObject({ newRange: '1.3.0', origin: { kind: 'public' } });
  });
});

describe('lookupVersions', () => {
  it('refuses to send internal names to a public registry', async () => {
    let queried = false;
    const strategy = {
      registry: {
        resolveEndpoint: async () => ({ url: 'https://registry.npmjs.org/', isPublic: true }),
        getAllVersions: async () => {
          queried = true;
          return [];
        },
      },
    } as unknown as EcosystemStrategy;
    const coordinate = { identifier: '@acme/core', artifact: '@acme/core', ecosystem: 'npm' as const };
    await expect(lookupVersions(strategy, coordinate, { rootDir: '/repo', internalScopes: ['@acme'] })).rejects.toThrow(
      PublicLookupRefusedError,
    );
    expect(queried).toBe(false);
  });
});
