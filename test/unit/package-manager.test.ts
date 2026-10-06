import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The process boundary is replaced: no npm is ever started. `runShellScript`
// stays real (and observable) because PM-09 runs a custom script.
const process_ = vi.hoisted(() => ({ runCommand: vi.fn(), runShellScript: vi.fn() }));
vi.mock('../../src/adapters/shared/process.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/adapters/shared/process.js')>();
  process_.runShellScript.mockImplementation(actual.runShellScript);
  return { ...actual, runCommand: process_.runCommand, runShellScript: process_.runShellScript };
});

import {
  UnsupportedPackageManagerError,
  detectPackageManager,
} from '../../src/adapters/npm/npm-package-manager.js';
import { NpmDependencyAdapter } from '../../src/adapters/npm/npm-scanner.js';
import { NpmUpdaterAdapter } from '../../src/adapters/npm/npm-updater.js';
import { NpmVerificationAdapter } from '../../src/adapters/npm/npm-verifier.js';
import { NpmRegistryAdapter } from '../../src/adapters/npm/npm-registry.js';
import { NpmConfigReader } from '../../src/adapters/npm/npm-config.js';
import { MavenModuleDiscoveryAdapter } from '../../src/adapters/maven/maven-discovery.js';
import { EcosystemFactory } from '../../src/domain/ecosystem-factory.js';
import { InstallError } from '../../src/domain/ports.js';
import { createScanContext, scanModule } from '../../src/application/scan.js';
import { runUpdateWorkflow } from '../../src/application/update-workflow.js';
import { cleanupTemp, makeTree, npmCandidate, npmModule, pom } from '../helpers.js';

beforeEach(() => {
  process_.runCommand.mockReset();
  process_.runShellScript.mockClear();
});
afterEach(cleanupTemp);

const PLAIN = '{"name": "root", "version": "1.0.0"}';

describe('package manager detection', () => {
  it.each([
    ['package-lock.json', 'npm'],
    ['npm-shrinkwrap.json', 'npm'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['pnpm-workspace.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['.yarnrc.yml', 'yarn'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
  ])('PM-01 A lockfile or workspace file identifies the package manager: %s', (file, manager) => {
    const root = makeTree({ 'package.json': PLAIN, [file]: '' });
    expect(detectPackageManager(root)).toEqual({ name: manager, evidence: file });
  });

  it('PM-02 The packageManager field wins over lockfiles', () => {
    const root = makeTree({
      'package.json': '{"name": "root", "packageManager": "pnpm@9.12.0"}',
      'package-lock.json': '{}',
    });
    expect(detectPackageManager(root)).toEqual({
      name: 'pnpm',
      evidence: '"packageManager": "pnpm@9.12.0" in package.json',
    });
  });

  it('PM-03 An npm lockfile wins over a leftover lockfile of another manager', () => {
    const root = makeTree({ 'package.json': PLAIN, 'package-lock.json': '{}', 'yarn.lock': '' });
    expect(detectPackageManager(root).name).toBe('npm');
  });

  it('PM-04 An unknown packageManager value is ignored', () => {
    const root = makeTree({ 'package.json': '{"name": "root", "packageManager": "deno@2.0.0"}', 'yarn.lock': '' });
    expect(detectPackageManager(root).name).toBe('yarn');
  });

  it('PM-13 A package inside a pnpm workspace is recognised from the workspace root', async () => {
    const root = makeTree({
      '.git/HEAD': 'ref: refs/heads/main',
      'package.json': '{"name": "root", "private": true}',
      'pnpm-workspace.yaml': 'packages: ["packages/*"]',
      'pnpm-lock.yaml': "lockfileVersion: '9.0'",
      'packages/a/package.json': '{"name": "a", "version": "1.0.0", "dependencies": {"left-pad": "^1.1.0"}}',
    });
    const packageDir = join(root, 'packages', 'a');
    expect(detectPackageManager(packageDir)).toEqual({ name: 'pnpm', evidence: 'pnpm-lock.yaml' });

    const module = npmModule(packageDir);
    const context = createScanContext([module], { rootDir: packageDir, internalScopes: [] }, 'stable');
    const scanner = new NpmDependencyAdapter(new NpmRegistryAdapter(), new NpmConfigReader());
    const failure = await scanner.scan(module, context).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(UnsupportedPackageManagerError);
    expect((failure as Error).message.startsWith('This repository is managed by pnpm')).toBe(true);
    expect(process_.runCommand).not.toHaveBeenCalled();
  });

  it('PM-14 Lockfiles outside the checkout are ignored', () => {
    const root = makeTree({
      'yarn.lock': '',
      'repo/.git/HEAD': 'ref: refs/heads/main',
      'repo/package.json': PLAIN,
    });
    expect(detectPackageManager(join(root, 'repo'))).toEqual({
      name: 'npm',
      evidence: 'no other package manager detected',
    });
  });

  it('PM-15 Without a checkout only the directory itself is examined', () => {
    const root = makeTree({ 'yarn.lock': '', 'project/package.json': PLAIN });
    expect(detectPackageManager(join(root, 'project')).name).toBe('npm');
  });

  it('PM-10 A repository without any lockfile is treated as npm', () => {
    const root = makeTree({ 'package.json': PLAIN });
    expect(detectPackageManager(root)).toEqual({ name: 'npm', evidence: 'no other package manager detected' });
  });
});

describe('refusal in a repository not managed by npm', () => {
  const MESSAGE =
    "This repository is managed by pnpm (pnpm-lock.yaml). Elevate supports npm for Node.js projects; using it here would create an npm lockfile next to pnpm's. Nothing was changed.";
  const PACKAGE_JSON = '{"name": "root", "version": "1.0.0", "dependencies": {"left-pad": "^1.1.0"}}';

  function pnpmTree() {
    return makeTree({
      'package.json': PACKAGE_JSON,
      'pnpm-lock.yaml': "lockfileVersion: '9.0'",
      'pnpm-workspace.yaml': 'packages: ["packages/*"]',
      'packages/a/package.json': '{"name": "a", "version": "1.0.0"}',
    });
  }

  const noProcessStarted = () => {
    expect(process_.runCommand).not.toHaveBeenCalled();
    expect(process_.runShellScript).not.toHaveBeenCalled();
  };

  it('PM-05 A scan is refused with an explanation', async () => {
    const root = pnpmTree();
    const module = npmModule(root);
    const context = createScanContext([module], { rootDir: root, internalScopes: [] }, 'stable');

    const scanner = new NpmDependencyAdapter(new NpmRegistryAdapter(), new NpmConfigReader());
    const failure = await scanner.scan(module, context).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(UnsupportedPackageManagerError);
    expect((failure as Error).message).toBe(MESSAGE);

    const scanned = await scanModule(EcosystemFactory.getStrategy('npm'), module, context);
    expect(scanned).toEqual({ candidates: [], skipped: [], error: MESSAGE });
    noProcessStarted();
  });

  it('PM-06 An update is refused before anything is written', async () => {
    const root = pnpmTree();
    const candidate = npmCandidate('left-pad', '^1.1.0', '^1.3.0');

    const failure = await new NpmUpdaterAdapter()
      .applyUpdates(npmModule(root), root, [candidate], () => {})
      .catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(InstallError);
    expect((failure as Error).message.startsWith('This repository is managed by pnpm')).toBe(true);
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(PACKAGE_JSON);
    expect(existsSync(join(root, 'package-lock.json'))).toBe(false);
    expect(existsSync(join(root, 'node_modules'))).toBe(false);
    noProcessStarted();
  });

  it('PM-07 The update workflow fails cleanly and does not run npm while rolling back', async () => {
    const root = pnpmTree();
    const candidate = npmCandidate('left-pad', '^1.1.0', '^1.3.0');

    const summary = await runUpdateWorkflow(EcosystemFactory.getStrategy('npm'), npmModule(root), root, [candidate]);
    expect(summary.rolledBack).toBe(true);
    expect(summary.failure).toContain('managed by pnpm');
    expect(summary.updatedCount).toBe(0);
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(PACKAGE_JSON);
    expect(existsSync(join(root, 'package-lock.json'))).toBe(false);
    expect(existsSync(join(root, 'node_modules'))).toBe(false);
    noProcessStarted();
  });

  it('PM-08 The default verification is refused instead of running npm ls', async () => {
    const root = pnpmTree();
    const result = await new NpmVerificationAdapter().verify(npmModule(root), root);
    expect(result.status).toBe('warn');
    expect(result.details.startsWith('This repository is managed by pnpm')).toBe(true);
    noProcessStarted();
  });

  it('PM-09 A custom verification script still runs', async () => {
    const root = pnpmTree();
    const result = await new NpmVerificationAdapter().verify(npmModule(root), root, {
      customScript: 'node -e "process.exit(0)"',
    });
    expect(result.status).toBe('clean');
  });
});

describe('everything that does not act as npm keeps working', () => {
  it('PM-11 Maven modules in a pnpm repository are still discovered', async () => {
    const root = makeTree({
      'package.json': PLAIN,
      'pnpm-lock.yaml': "lockfileVersion: '9.0'",
      'backend/pom.xml': pom('<groupId>g</groupId><artifactId>backend</artifactId><version>1</version>'),
    });
    const modules = await new MavenModuleDiscoveryAdapter().discover(root);
    expect(modules.map((m) => m.id)).toEqual(['g:backend']);
  });

  it('PM-12 Version queries are not blocked', async () => {
    const dir = makeTree({ 'pnpm-lock.yaml': "lockfileVersion: '9.0'" });
    process_.runCommand.mockResolvedValue({ exitCode: 0, stdout: '["1.0.0", "1.1.0"]', stderr: '', timedOut: false });

    const coordinate = { identifier: 'left-pad', artifact: 'left-pad', ecosystem: 'npm' as const };
    const versions = await new NpmRegistryAdapter().getAllVersions(coordinate, dir);
    expect(versions).toEqual(['1.1.0', '1.0.0']);
    expect(process_.runCommand).toHaveBeenCalledWith(
      'npm',
      ['view', 'left-pad', 'versions', '--json'],
      expect.objectContaining({ cwd: dir }),
    );
  });
});
