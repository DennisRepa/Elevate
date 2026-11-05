import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const process_ = vi.hoisted(() => ({ runCommand: vi.fn() }));
vi.mock('../../src/adapters/shared/process.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/adapters/shared/process.js')>();
  return { ...actual, runCommand: process_.runCommand };
});

import { PackageManagerNotFoundError } from '../../src/adapters/npm/npm-package-manager.js';
import { NpmDependencyAdapter } from '../../src/adapters/npm/npm-scanner.js';
import { NpmUpdaterAdapter } from '../../src/adapters/npm/npm-updater.js';
import { NpmVerificationAdapter } from '../../src/adapters/npm/npm-verifier.js';
import { NpmRegistryAdapter } from '../../src/adapters/npm/npm-registry.js';
import { NpmConfigReader, isPublicNpmRegistry } from '../../src/adapters/npm/npm-config.js';
import { parsePnpmAudit } from '../../src/adapters/npm/pnpm-audit.js';
import { EcosystemFactory } from '../../src/domain/ecosystem-factory.js';
import { InstallError } from '../../src/domain/ports.js';
import { createScanContext, scanModule } from '../../src/application/scan.js';
import { runUpdateWorkflow } from '../../src/application/update-workflow.js';
import { cleanupTemp, makeTree, npmCandidate, npmModule } from '../helpers.js';

const ok = { exitCode: 0, stdout: '', stderr: '', timedOut: false };
type Reply = { exitCode: number; stdout: string; stderr: string; timedOut: boolean } | Error;
let replies: Record<string, Reply> = {};

/** Answers by the command line `pnpm install --frozen-lockfile`; unlisted commands succeed. */
function respond(command: string, args: string[]) {
  const reply = replies[[command, ...args].join(' ')];
  if (reply instanceof Error) throw reply;
  return Promise.resolve(reply ?? ok);
}
const lines = () => process_.runCommand.mock.calls.map((c) => [c[0], ...c[1]].join(' '));

// pnpm --version is remembered per root, so every test uses a fresh tree.
const PACKAGE_JSON = '{"name": "root", "version": "1.0.0", "dependencies": {"left-pad": "^1.1.0"}}';
function pnpmRepo(extra: Record<string, string> = {}) {
  return makeTree({
    'package.json': PACKAGE_JSON,
    'pnpm-lock.yaml': "lockfileVersion: '9.0'",
    'pnpm-workspace.yaml': 'packages: ["packages/*"]',
    ...extra,
  });
}
const candidate = () => npmCandidate('left-pad', '^1.1.0', '^1.3.0');
const strategy = () => EcosystemFactory.getStrategy('npm');

beforeEach(() => {
  replies = {};
  process_.runCommand.mockReset();
  process_.runCommand.mockImplementation(respond);
});
afterEach(cleanupTemp);

describe('pnpm must be runnable', () => {
  it.each([
    [new Error('spawn pnpm ENOENT'), 'command not found'],
    [{ exitCode: 1, stdout: '', stderr: '', timedOut: true }, 'pnpm --version timed out'],
    [
      { exitCode: 1, stdout: '', stderr: 'Internal Error: Cannot find matching keyid\nmore', timedOut: false },
      'pnpm --version exited with code 1: Internal Error: Cannot find matching keyid',
    ],
  ] as [Reply, string][])('PINST-01 A scan fails with an explanation', async (reply, reason) => {
    replies['pnpm --version'] = reply;
    const root = pnpmRepo();
    const mod = npmModule(root);
    const context = createScanContext([mod], { rootDir: root, internalScopes: [] }, 'stable');
    const scanner = new NpmDependencyAdapter(new NpmRegistryAdapter(), new NpmConfigReader());
    const failure = await scanner.scan(mod, context).catch((e: unknown) => e);
    const message = `pnpm could not be run in this repository (${reason}). This repository is managed by pnpm (pnpm-lock.yaml); install pnpm or enable Corepack (corepack enable). Nothing was changed.`;
    expect(failure).toBeInstanceOf(PackageManagerNotFoundError);
    expect((failure as Error).message).toBe(message);
    expect(lines()).toEqual(['pnpm --version']);
    expect(await scanModule(strategy(), mod, context)).toEqual({ candidates: [], skipped: [], error: message });
  });

  it('PINST-02 The Windows shell message is the same failure', async () => {
    replies['pnpm --version'] = {
      exitCode: 1,
      stdout: '',
      stderr: "'pnpm' is not recognized as an internal or external command,",
      timedOut: false,
    };
    const root = pnpmRepo();
    const failure = await new NpmUpdaterAdapter()
      .applyUpdates(npmModule(root), root, [candidate()], () => {})
      .catch((e: unknown) => e);
    expect((failure as Error).message).toContain('pnpm could not be run in this repository (pnpm --version exited with code 1:');
  });

  it('PINST-03 An update is refused before anything is written', async () => {
    replies['pnpm --version'] = new Error('ENOENT');
    const root = pnpmRepo();
    const failure = await new NpmUpdaterAdapter()
      .applyUpdates(npmModule(root), root, [candidate()], () => {})
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(InstallError);
    expect((failure as Error).message.startsWith('pnpm could not be run in this repository')).toBe(true);
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(PACKAGE_JSON);
    expect(lines()).toEqual(['pnpm --version']);
  });

  it('PINST-04 The default verification reports it instead of passing', async () => {
    replies['pnpm --version'] = new Error('ENOENT');
    const root = pnpmRepo();
    const result = await new NpmVerificationAdapter().verify(npmModule(root), root);
    expect(result.status).toBe('warn');
    expect(result.details.startsWith('pnpm could not be run in this repository')).toBe(true);
  });

  it('PINST-05 pnpm is checked once per repository, a failure is not remembered', async () => {
    const root = pnpmRepo();
    const mod = npmModule(root);
    const context = createScanContext([mod], { rootDir: root, internalScopes: [] }, 'stable');
    const scanner = new NpmDependencyAdapter(new NpmRegistryAdapter(), new NpmConfigReader());
    await scanner.scan(mod, context);
    await scanner.scan(mod, context);
    expect(lines().filter((l) => l === 'pnpm --version')).toHaveLength(1);
  });
});

describe('ranges are written and installed with pnpm', () => {
  it('PINST-06 Install, then the vulnerability summary', async () => {
    replies['pnpm audit --json'] = {
      ...ok,
      stdout: '{"advisories": {}, "metadata": {"vulnerabilities": {"info": 0, "low": 0, "moderate": 0, "high": 0, "critical": 0}}}',
    };
    const root = pnpmRepo();
    const outcome = await new NpmUpdaterAdapter().applyUpdates(npmModule(root), root, [candidate()], () => {});
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies['left-pad']).toBe('^1.3.0');
    expect(lines()).toEqual(['pnpm --version', 'pnpm install --no-frozen-lockfile', 'pnpm audit --json']);
    expect(process_.runCommand.mock.calls.every((c) => c[0] === 'pnpm' && c[2].cwd === root)).toBe(true);
    expect(outcome).toMatchObject({ auditSeverity: 'clean', fundingMessage: undefined });
  });

  it('PINST-07 A set CI variable does not freeze the install', async () => {
    vi.stubEnv('CI', 'true');
    try {
      const root = pnpmRepo();
      await new NpmUpdaterAdapter().applyUpdates(npmModule(root), root, [candidate()], () => {});
      expect(process_.runCommand.mock.calls.find((c) => c[1][0] === 'install')![1]).toEqual(['install', '--no-frozen-lockfile']);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('PINST-09 Formatting is preserved and resolution settings are left alone', async () => {
    const original = JSON.stringify(
      {
        name: 'root',
        dependencies: { 'left-pad': '^1.1.0' },
        peerDependencies: { 'left-pad': '^1.0.0' },
        pnpm: { overrides: { 'left-pad': '^1.1.0' } },
        resolutions: { 'left-pad': '^1.1.0' },
      },
      null,
      '\t',
    ).replace(/\n/g, '\r\n') + '\r\n';
    const yaml = 'packages: []\noverrides: {left-pad: ^1.1.0}\n';
    const root = makeTree({ 'package.json': original, 'pnpm-lock.yaml': '', 'pnpm-workspace.yaml': yaml });
    await new NpmUpdaterAdapter().applyUpdates(npmModule(root), root, [candidate()], () => {});
    const after = readFileSync(join(root, 'package.json'), 'utf8');
    expect(after).toBe(original.replace('"left-pad": "^1.1.0"\r\n\t},\r\n\t"peer', '"left-pad": "^1.3.0"\r\n\t},\r\n\t"peer'));
    expect(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')).toBe(yaml);
  });

  it('PINST-10 The files that may change', () => {
    const root = pnpmRepo();
    const mod = npmModule(join(root, 'packages', 'a'), 'a', false);
    expect(new NpmUpdaterAdapter().affectedFiles(mod, root)).toEqual([
      join(root, 'packages', 'a', 'package.json'),
      join(root, 'package.json'),
      join(root, 'pnpm-lock.yaml'),
      join(root, 'pnpm-workspace.yaml'),
    ]);
  });

  it('PINST-11 No funding hint is reported', async () => {
    replies['pnpm install --no-frozen-lockfile'] = { ...ok, stdout: 'Done in 1s' };
    const root = pnpmRepo();
    const outcome = await new NpmUpdaterAdapter().applyUpdates(npmModule(root), root, [candidate()], () => {});
    expect(outcome.fundingMessage).toBeUndefined();
  });
});

describe('a failed install is rolled back, in pnpm’s own words', () => {
  it.each([
    ['ERR_PNPM_NO_MATCHING_VERSION  No matching version', '', 'ERR_PNPM_NO_MATCHING_VERSION'],
    ['', 'Error: ERR_PNPM_NO_MATCHING_VERSION', 'Error: ERR_PNPM_NO_MATCHING_VERSION'],
    ['ERR_PNPM_NO_MATCHING_VERSION  No matching version', 'WARN  deprecated left-pad@1.3.0', 'ERR_PNPM_NO_MATCHING_VERSION'],
    ['ERR_PNPM_IGNORED_BUILDS  Ignored build scripts: left-pad@1.3.0', '', 'Ignored build scripts: left-pad@1.3.0'],
  ])('PINST-12/13 The failure quotes pnpm', async (stdout, stderr, line) => {
    replies['pnpm install --no-frozen-lockfile'] = { exitCode: 1, stdout, stderr, timedOut: false };
    const root = pnpmRepo();
    const summary = await runUpdateWorkflow(strategy(), npmModule(root), root, [candidate()]);
    expect(summary.rolledBack).toBe(true);
    expect(summary.failure?.startsWith('pnpm install failed')).toBe(true);
    expect(summary.failure).toContain(line);
    expect(summary.updatedCount).toBe(0);
  });

  it('PINST-14 A timeout is reported as such', async () => {
    replies['pnpm install --no-frozen-lockfile'] = { exitCode: 1, stdout: '', stderr: '', timedOut: true };
    const root = pnpmRepo();
    const summary = await runUpdateWorkflow(strategy(), npmModule(root), root, [candidate()]);
    expect(summary.rolledBack).toBe(true);
    expect(summary.failure?.startsWith('pnpm install timed out')).toBe(true);
  });

  it('PINST-15 The rollback restores every touched file and restores with a frozen install', async () => {
    const files = { 'pnpm-lock.yaml': 'lock\n', 'pnpm-workspace.yaml': 'packages: []\n' };
    const root = pnpmRepo(files);
    process_.runCommand.mockImplementation(async (c: string, args: string[]) => {
      if (args.includes('--no-frozen-lockfile')) {
        for (const f of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) writeFileSync(join(root, f), 'changed');
        return { exitCode: 1, stdout: '', stderr: '', timedOut: false };
      }
      return respond(c, args);
    });
    const summary = await runUpdateWorkflow(strategy(), npmModule(root), root, [candidate()]);
    expect(summary.rolledBack).toBe(true);
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(PACKAGE_JSON);
    expect(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')).toBe(files['pnpm-lock.yaml']);
    expect(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')).toBe(files['pnpm-workspace.yaml']);
    expect(lines().at(-1)).toBe('pnpm install --frozen-lockfile');
  });

  it('PINST-16 A restore that fails is reported next to the original failure', async () => {
    replies['pnpm install --no-frozen-lockfile'] = { exitCode: 1, stdout: '', stderr: '', timedOut: false };
    replies['pnpm install --frozen-lockfile'] = { exitCode: 1, stdout: '', stderr: '', timedOut: false };
    const root = pnpmRepo();
    const summary = await runUpdateWorkflow(strategy(), npmModule(root), root, [candidate()]);
    expect(summary.failure?.startsWith('pnpm install failed')).toBe(true);
    expect(summary.failure).toContain(
      'Restoring the installed state failed as well: pnpm install failed while restoring the previous state',
    );
  });
});

describe('default verification', () => {
  const VERIFY = 'pnpm install --frozen-lockfile --lockfile-only';

  it('PINST-17 A consistent lockfile is clean', async () => {
    const root = pnpmRepo();
    const result = await new NpmVerificationAdapter().verify(npmModule(root), root);
    expect(result).toEqual({
      status: 'clean',
      details: 'pnpm-lock.yaml is up to date with all package.json files.',
      label: 'Lockfile consistency (pnpm install --frozen-lockfile)',
    });
    expect(lines()).toEqual(['pnpm --version', VERIFY]);
  });

  it.each([
    ['ERR_PNPM_OUTDATED_LOCKFILE  Cannot install', ''],
    ['', 'Error: ERR_PNPM_OUTDATED_LOCKFILE'],
  ])('PINST-18 A stale lockfile is a warning that quotes pnpm', async (stdout, stderr) => {
    replies[VERIFY] = { exitCode: 1, stdout, stderr, timedOut: false };
    const root = pnpmRepo();
    const result = await new NpmVerificationAdapter().verify(npmModule(root), root);
    expect(result.status).toBe('warn');
    expect(result.details).toContain('ERR_PNPM_OUTDATED_LOCKFILE');
  });

  it('PINST-19 A verification that does not finish is a warning', async () => {
    replies[VERIFY] = { exitCode: 1, stdout: '', stderr: '', timedOut: true };
    const root = pnpmRepo();
    expect(await new NpmVerificationAdapter().verify(npmModule(root), root)).toMatchObject({
      status: 'warn',
      details: 'Verification timed out.',
    });
  });

  it('PINST-20 A custom script needs no pnpm', async () => {
    const root = pnpmRepo();
    const result = await new NpmVerificationAdapter().verify(npmModule(root), root, {
      customScript: 'node -e "process.exit(0)"',
    });
    expect(result.status).toBe('clean');
    expect(process_.runCommand).not.toHaveBeenCalled();
  });
});

describe('vulnerability summary', () => {
  const counts = (c: Record<string, number>) => JSON.stringify({ advisories: {}, metadata: { vulnerabilities: c } });
  const zero = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };

  it('PINST-22 No vulnerabilities is clean', () => {
    expect(parsePnpmAudit(counts(zero))).toEqual({ message: 'No known vulnerabilities found.', severity: 'clean' });
  });

  it.each([
    [{ high: 1 }, '1 vulnerability (1 high)'],
    [{ moderate: 3, high: 3 }, '6 vulnerabilities (3 moderate, 3 high)'],
    [{ info: 1, low: 2, critical: 1 }, '4 vulnerabilities (1 info, 2 low, 1 critical)'],
  ])('PINST-23 Vulnerabilities are a warning that names the counts', (c, message) => {
    expect(parsePnpmAudit(counts({ ...zero, ...c }))).toEqual({ message, severity: 'warn' });
  });

  it('PINST-24 The exit code does not decide', async () => {
    replies['pnpm audit --json'] = { exitCode: 1, stdout: counts({ ...zero, high: 2 }), stderr: '', timedOut: false };
    const root = pnpmRepo();
    const outcome = await new NpmUpdaterAdapter().applyUpdates(npmModule(root), root, [candidate()], () => {});
    expect(outcome).toMatchObject({ auditSeverity: 'warn', auditMessage: '2 vulnerabilities (2 high)' });
  });

  it.each([
    ['{"error": {"code": "ECONNREFUSED", "message": "request failed"}}', 'Vulnerability check unavailable: request failed.'],
    ['', 'Vulnerability check unavailable: pnpm audit returned no result.'],
    ['{"advisories": {}}', 'Vulnerability check unavailable: pnpm audit returned no result.'],
    ['<html>502 Bad Gateway</html>', 'Vulnerability check unavailable: pnpm audit returned no result.'],
  ])('PINST-25 An audit without a result is a warning', (output, message) => {
    expect(parsePnpmAudit(output)).toEqual({ message, severity: 'warn' });
  });

  it('PINST-26 An audit that hangs does not fail the update', async () => {
    replies['pnpm audit --json'] = { exitCode: 1, stdout: '', stderr: '', timedOut: true };
    const root = pnpmRepo();
    const summary = await runUpdateWorkflow(strategy(), npmModule(root), root, [candidate()]);
    expect(summary.rolledBack).toBeFalsy();
    expect(summary.updatedCount).toBe(1);
    expect(summary.auditSeverity).toBe('warn');
    expect(summary.auditMessage).toBe('Vulnerability check unavailable: pnpm audit timed out after 60 seconds.');
  });
});

describe('versions and configuration come from pnpm', () => {
  it('PINST-27 Version queries use pnpm view', async () => {
    const dir = makeTree({ 'pnpm-lock.yaml': '' });
    process_.runCommand.mockResolvedValue({ ...ok, stdout: '["1.0.0", "1.1.0"]' });
    const coordinate = { identifier: 'left-pad', artifact: 'left-pad', ecosystem: 'npm' as const };
    const registry = new NpmRegistryAdapter();
    expect(await registry.getAllVersions(coordinate, dir)).toEqual(['1.1.0', '1.0.0']);
    expect(process_.runCommand).toHaveBeenCalledWith('pnpm', ['view', 'left-pad', 'versions', '--json'], expect.objectContaining({ cwd: dir }));
    process_.runCommand.mockResolvedValue({ ...ok, stdout: '"1.1.0"' });
    expect(await registry.getLatestVersion(coordinate, 'stable', dir)).toBe('1.1.0');
    expect(lines().at(-1)).toBe('pnpm view left-pad dist-tags.latest --json');
    expect(process_.runCommand.mock.calls.some((c) => c[0] === 'npm')).toBe(false);
  });

  it('PINST-28 Registry mappings come from pnpm’s configuration', async () => {
    const dir = makeTree({ 'pnpm-lock.yaml': '' });
    process_.runCommand.mockResolvedValue({
      ...ok,
      stdout: '{"registry": "https://registry.npmjs.org/", "@acme:registry": "https://npm.acme.example/", "@jsr:registry": "https://npm.jsr.io/"}',
    });
    const config = await new NpmConfigReader().read(dir);
    expect(lines()).toEqual(['pnpm config list --json']);
    expect(config.scopedRegistries.get('@acme')).toBe('https://npm.acme.example/');
  });

  it.each([
    ['https://registry.npmjs.org/', true],
    ['https://npm.jsr.io/', true],
    ['https://npm.acme.example/', false],
  ])('PINST-29 %s is public: %s', (url, expected) => {
    expect(isPublicNpmRegistry(url)).toBe(expected);
  });

  it('PINST-30 A repository managed by npm keeps using npm', async () => {
    const root = makeTree({ 'package.json': PACKAGE_JSON, 'package-lock.json': '{}' });
    const mod = npmModule(root);
    const context = createScanContext([mod], { rootDir: root, internalScopes: [] }, 'stable');
    await new NpmDependencyAdapter(new NpmRegistryAdapter(), new NpmConfigReader()).scan(mod, context);
    await new NpmUpdaterAdapter().applyUpdates(mod, root, [candidate()], () => {});
    expect(process_.runCommand.mock.calls.length).toBeGreaterThan(0);
    expect(process_.runCommand.mock.calls.every((c) => c[0] === 'npm')).toBe(true);
  });
});
