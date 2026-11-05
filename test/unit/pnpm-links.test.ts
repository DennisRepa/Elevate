import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const process_ = vi.hoisted(() => ({ runCommand: vi.fn() }));
vi.mock('../../src/adapters/shared/process.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/adapters/shared/process.js')>();
  return { ...actual, runCommand: process_.runCommand };
});

import { NpmUpdaterAdapter } from '../../src/adapters/npm/npm-updater.js';
import { EcosystemFactory } from '../../src/domain/ecosystem-factory.js';
import { describeSkip } from '../../src/application/describe.js';
import { runUpdateWorkflow } from '../../src/application/update-workflow.js';
import { findUnlinkedPnpmDependencies, readPnpmLockfile } from '../../src/adapters/npm/pnpm-lockfile.js';
import { cleanupTemp, makeTree, npmCandidate, npmModule } from '../helpers.js';
import { scanModuleOf } from '../pnpm-helpers.js';

const ok = { exitCode: 0, stdout: '', stderr: '', timedOut: false };
beforeEach(() => {
  process_.runCommand.mockReset();
  process_.runCommand.mockResolvedValue(ok);
});
afterEach(cleanupTemp);

function repo(appDeps: Record<string, string>, extra: Record<string, string> = {}) {
  return makeTree({
    'package.json': '{"name": "mono", "private": true}',
    'pnpm-workspace.yaml': 'packages: ["packages/*"]',
    'pnpm-lock.yaml': "lockfileVersion: '9.0'",
    'packages/app/package.json': JSON.stringify({ name: '@acme/app', version: '1.0.0', dependencies: appDeps }),
    'packages/lib/package.json': '{"name": "@acme/lib", "version": "2.0.0"}',
    ...extra,
  });
}

describe('workspace: ranges', () => {
  it.each(['workspace:*', 'workspace:^', 'workspace:~', 'workspace:../lib'])(
    'PLINK-01 %s needs no alignment',
    async (range) => {
      const { result, registry } = await scanModuleOf(repo({ '@acme/lib': range }), '@acme/app');
      expect(result).toEqual({ candidates: [], skipped: [] });
      expect(registry.asked).toEqual([]);
    },
  );

  it('PLINK-02 A range that excludes the local version is aligned', async () => {
    const { result, registry } = await scanModuleOf(repo({ '@acme/lib': 'workspace:^1.2.0' }), '@acme/app');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      currentRange: 'workspace:^1.2.0',
      newRange: 'workspace:^2.0.0',
      action: 'align',
      diff: 'major',
      selected: false,
      origin: { kind: 'workspace' },
    });
    expect(registry.asked).toEqual([]);
  });

  it.each([
    ['workspace:^1.2.0', 'workspace:^2.0.0'],
    ['workspace:~1.2.0', 'workspace:~2.0.0'],
    ['workspace:1.2.0', 'workspace:2.0.0'],
  ])('PLINK-03 The prefix is kept: %s', async (declared, aligned) => {
    const { result } = await scanModuleOf(repo({ '@acme/lib': declared }), '@acme/app');
    expect(result.candidates[0]!.newRange).toBe(aligned);
  });

  it('PLINK-04 A range that includes the local version needs nothing', async () => {
    const { result } = await scanModuleOf(repo({ '@acme/lib': 'workspace:^2.0.0' }), '@acme/app');
    expect(result).toEqual({ candidates: [], skipped: [] });
  });

  it('PLINK-05 An aligned range is written and verified against the lockfile', async () => {
    const root = repo(
      { '@acme/lib': 'workspace:^1.2.0' },
      {
        'pnpm-lock.yaml':
          "lockfileVersion: '9.0'\nimporters:\n  packages/app:\n    dependencies:\n      '@acme/lib':\n        specifier: workspace:^2.0.0\n        version: link:../lib\n",
      },
    );
    const candidate = {
      ...npmCandidate('@acme/lib', 'workspace:^1.2.0', 'workspace:^2.0.0'),
      action: 'align' as const,
      origin: { kind: 'workspace' as const, moduleId: '@acme/lib', moduleRelPath: 'packages/lib' },
    };
    const mod = npmModule(join(root, 'packages', 'app'), '@acme/app', false);
    const outcome = await new NpmUpdaterAdapter().applyUpdates(mod, root, [candidate], () => {});
    expect(JSON.parse(readFileSync(join(root, 'packages/app/package.json'), 'utf8')).dependencies['@acme/lib']).toBe(
      'workspace:^2.0.0',
    );
    expect(outcome.integrityViolations).toEqual([]);
  });
});

describe('plain ranges on a module', () => {
  it.each(['^2.0.0', '^1.0.0', '2.0.0'])('PLINK-06 %s is listed as not linked', async (range) => {
    const { result, registry } = await scanModuleOf(repo({ '@acme/lib': range }), '@acme/app');
    expect(result.candidates).toEqual([]);
    expect(result.skipped).toEqual([
      { identifier: '@acme/lib', origin: 'workspace', reason: 'not-linked', detail: range },
    ]);
    expect(registry.asked).toEqual([]);
  });

  it('PLINK-07 A module named like a public package is not looked up', async () => {
    const root = repo({ 'left-pad': '^1.0.0' }, { 'packages/lp/package.json': '{"name": "left-pad", "version": "1.0.0"}' });
    const { result, registry } = await scanModuleOf(root, '@acme/app', { 'left-pad': '1.3.0' });
    expect(result.candidates).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ identifier: 'left-pad', reason: 'not-linked' });
    expect(registry.asked).toEqual([]);
  });

  it('PLINK-08 The reason is explained in the output', () => {
    expect(
      describeSkip({ identifier: '@acme/lib', origin: 'workspace', reason: 'not-linked', detail: '^2.0.0' }),
    ).toBe('workspace package that pnpm does not link unless it is declared with the workspace: protocol (^2.0.0)');
  });

  it('keeps `workspace:` and `catalog:` ranges inert in an npm repository', async () => {
    const root = makeTree({
      'package.json': '{"name": "mono", "workspaces": ["packages/*"]}',
      'package-lock.json': '{}',
      'packages/app/package.json': '{"name": "@acme/app", "version": "1.0.0", "dependencies": {"@acme/lib": "workspace:^1.2.0", "x": "catalog:"}}',
      'packages/lib/package.json': '{"name": "@acme/lib", "version": "2.0.0"}',
    });
    const { result, registry } = await scanModuleOf(root, '@acme/app');
    expect(result).toEqual({ candidates: [], skipped: [] });
    expect(registry.asked).toEqual([]);
  });
});

describe('lockfile proof', () => {
  const lock = (importers: string) => makeTree({ 'pnpm-lock.yaml': `lockfileVersion: '9.0'\n\nimporters:\n\n${importers}` });
  const check = (root: string, rel = 'packages/app') =>
    findUnlinkedPnpmDependencies(readPnpmLockfile(root), rel, ['@acme/lib']);

  it.each(['dependencies', 'devDependencies', 'optionalDependencies'])(
    'PLINK-09 A linked dependency passes in %s',
    (section) => {
      const root = lock(
        `  packages/app:\n    ${section}:\n      '@acme/lib':\n        specifier: workspace:^2.0.0\n        version: link:../lib\n`,
      );
      expect(check(root)).toEqual([]);
    },
  );

  it('PLINK-10 The root module is the importer "."', () => {
    const root = lock(`  .:\n    dependencies:\n      '@acme/lib':\n        specifier: workspace:^2.0.0\n        version: link:packages/lib\n`);
    expect(check(root, '')).toEqual([]);
  });

  it('PLINK-11 A dependency resolved from the registry is a violation', () => {
    const root = lock(`  packages/app:\n    dependencies:\n      '@acme/lib':\n        specifier: ^2.0.0\n        version: 2.3.1\n`);
    expect(check(root)).toEqual(['@acme/lib: resolved to 2.3.1 instead of linking the workspace package']);
  });

  it('PLINK-12 A dependency missing from the importer is a violation', () => {
    expect(check(lock('  packages/app: {}\n'))).toEqual(['@acme/lib: not present in pnpm-lock.yaml']);
  });

  it.each([
    [{}, 'pnpm-lock.yaml is missing; workspace links cannot be verified'],
    [
      { 'pnpm-lock.yaml': 'importers: [unclosed' },
      'pnpm-lock.yaml could not be read; workspace links cannot be verified',
    ],
    [
      { 'pnpm-lock.yaml': "lockfileVersion: '6.0'" },
      "pnpm-lock.yaml has lockfileVersion '6.0', which Elevate cannot read; workspace links cannot be verified",
    ],
  ])('PLINK-13 A lockfile that cannot be checked is a violation', (files, violation) => {
    expect(check(makeTree(files))).toEqual([violation]);
  });

  it('PLINK-14 A violation rolls the update back', async () => {
    const original =
      "lockfileVersion: '9.0'\nimporters:\n  packages/app:\n    dependencies:\n      '@acme/lib':\n        specifier: workspace:^1.2.0\n        version: link:../lib\n";
    const root = repo({ '@acme/lib': 'workspace:^1.2.0' }, { 'pnpm-lock.yaml': original });
    const manifest = readFileSync(join(root, 'packages/app/package.json'), 'utf8');
    process_.runCommand.mockImplementation(async (_c: string, args: string[]) => {
      if (args[0] === 'install' && args.includes('--no-frozen-lockfile')) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(join(root, 'pnpm-lock.yaml'), original.replace('link:../lib', '2.3.1'));
      }
      return ok;
    });
    const candidate = {
      ...npmCandidate('@acme/lib', 'workspace:^1.2.0', 'workspace:^2.0.0'),
      action: 'align' as const,
      origin: { kind: 'workspace' as const, moduleId: '@acme/lib', moduleRelPath: 'packages/lib' },
    };
    const mod = npmModule(join(root, 'packages', 'app'), '@acme/app', false);
    const summary = await runUpdateWorkflow(EcosystemFactory.getStrategy('npm'), mod, root, [candidate]);
    expect(summary.rolledBack).toBe(true);
    expect(summary.failure).toContain('Integrity check failed');
    expect(summary.failure).toContain('@acme/lib: resolved to 2.3.1 instead of linking the workspace package');
    expect(readFileSync(join(root, 'packages/app/package.json'), 'utf8')).toBe(manifest);
    expect(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')).toBe(original);
  });

  it('PLINK-15 Updates from a registry do not read the lockfile', async () => {
    const root = makeTree({
      'package.json': '{"name": "root", "version": "1.0.0", "dependencies": {"left-pad": "^1.1.0"}}',
      'pnpm-workspace.yaml': 'packages: []',
    });
    const outcome = await new NpmUpdaterAdapter().applyUpdates(
      npmModule(root),
      root,
      [npmCandidate('left-pad', '^1.1.0', '^1.3.0')],
      () => {},
    );
    expect(outcome.integrityViolations).toEqual([]);
  });
});
