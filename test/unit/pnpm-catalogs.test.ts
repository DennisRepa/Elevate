import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const process_ = vi.hoisted(() => ({ runCommand: vi.fn() }));
vi.mock('../../src/adapters/shared/process.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/adapters/shared/process.js')>();
  return { ...actual, runCommand: process_.runCommand };
});

import { NpmUpdaterAdapter } from '../../src/adapters/npm/npm-updater.js';
import { setCatalogRange } from '../../src/adapters/npm/pnpm-workspace.js';
import { EcosystemFactory } from '../../src/domain/ecosystem-factory.js';
import { describeSkip } from '../../src/application/describe.js';
import { candidateToJson } from '../../src/application/scan.js';
import { runUpdateWorkflow } from '../../src/application/update-workflow.js';
import { cleanupTemp, makeTree, npmCandidate, npmModule } from '../helpers.js';
import { scanModuleOf } from '../pnpm-helpers.js';
import type { UpdateCandidate } from '../../src/domain/models.js';

const ok = { exitCode: 0, stdout: '', stderr: '', timedOut: false };
beforeEach(() => {
  process_.runCommand.mockReset();
  process_.runCommand.mockResolvedValue(ok);
});
afterEach(cleanupTemp);

function repo(workspace: string | undefined, deps: Record<string, string>, section = 'dependencies') {
  const files: Record<string, string> = {
    'package.json': '{"name": "mono", "private": true}',
    'pnpm-lock.yaml': "lockfileVersion: '9.0'",
    'packages/app/package.json': JSON.stringify({ name: 'app', version: '1.0.0', [section]: deps }),
    'packages/web/package.json': JSON.stringify({ name: 'web', version: '1.0.0', dependencies: deps }),
  };
  if (workspace !== undefined) files['pnpm-workspace.yaml'] = workspace;
  return makeTree(files);
}
const WS = (catalog: string) => `packages: ["packages/*"]\n${catalog}\n`;

describe('catalog references', () => {
  it('CAT-01 An outdated entry of the default catalog is offered', async () => {
    const root = repo(WS('catalog:\n  left-pad: ^1.1.0'), { 'left-pad': 'catalog:' });
    const { result } = await scanModuleOf(root, 'app', { 'left-pad': '1.3.0' });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      currentRange: '^1.1.0',
      newRange: '^1.3.0',
      scope: 'prod',
      action: 'update',
      declaration: { kind: 'catalog', catalogName: 'default', displayPath: 'pnpm-workspace.yaml' },
    });
    expect(candidateToJson(result.candidates[0]!).declaredIn).toMatchObject({
      file: 'pnpm-workspace.yaml',
      kind: 'catalog',
      catalog: 'default',
    });
  });

  it('CAT-02 An entry of a named catalog is offered', async () => {
    const root = repo(WS('catalogs:\n  legacy:\n    is-odd: ^2.0.0'), { 'is-odd': 'catalog:legacy' });
    const { result } = await scanModuleOf(root, 'app', { 'is-odd': '3.0.1' });
    expect(result.candidates[0]).toMatchObject({
      currentRange: '^2.0.0',
      newRange: '^3.0.1',
      declaration: { catalogName: 'legacy' },
    });
  });

  it.each([
    ['catalog: {left-pad: ^1.1.0}', 'catalog:'],
    ['catalog: {left-pad: ^1.1.0}', 'catalog:default'],
    ['catalogs: {default: {left-pad: ^1.1.0}}', 'catalog:'],
    ['catalogs: {default: {left-pad: ^1.1.0}}', 'catalog:default'],
  ])('CAT-03 The default catalog in either form: %s / %s', async (catalog, reference) => {
    const root = repo(WS(catalog), { 'left-pad': reference });
    const { result } = await scanModuleOf(root, 'app', { 'left-pad': '1.3.0' });
    expect(result.candidates[0]).toMatchObject({ currentRange: '^1.1.0', declaration: { catalogName: 'default' } });
  });

  it.each([
    ['dependencies', 'prod'],
    ['optionalDependencies', 'prod'],
    ['devDependencies', 'dev'],
  ])('CAT-04 The scope follows the section: %s', async (section, scope) => {
    const root = repo(WS('catalog: {left-pad: ^1.1.0}'), { 'left-pad': 'catalog:' }, section);
    const { result } = await scanModuleOf(root, 'app', { 'left-pad': '1.3.0' });
    expect(result.candidates[0]!.scope).toBe(scope);
  });

  it.each(['*', 'latest', 'npm:left-pad@^1.0.0'])('CAT-05 An entry that is not SemVer is not offered: %s', async (entry) => {
    const root = repo(WS(`catalog: {left-pad: "${entry}"}`), { 'left-pad': 'catalog:' });
    const { result, registry } = await scanModuleOf(root, 'app', { 'left-pad': '1.3.0' });
    expect(result).toEqual({ candidates: [], skipped: [] });
    expect(registry.asked).toEqual([]);
  });

  it('CAT-06 An internal package in a catalog is never looked up on a public registry', async () => {
    const root = repo(WS('catalog: {"@acme/billing": ^1.0.0}'), { '@acme/billing': 'catalog:' });
    const { result, registry } = await scanModuleOf(root, 'app', { '@acme/billing': '2.0.0' }, ['@acme']);
    expect(result.candidates).toEqual([]);
    expect(result.skipped[0]).toMatchObject({
      identifier: '@acme/billing',
      origin: 'private',
      reason: 'private-on-public-registry',
    });
    expect(registry.asked).toEqual([]);
  });

  it('CAT-07 Peer dependencies, overrides and unused entries are not offered', async () => {
    const root = repo(
      WS('catalog:\n  react: ^17.0.0\n  left-pad: ^1.1.0\n  is-odd: ^2.0.0\noverrides:\n  is-odd: catalog:'),
      { react: 'catalog:' },
      'peerDependencies',
    );
    // `web` declares the same dependencies as a regular dependency; look at `app` only.
    const { result, registry } = await scanModuleOf(root, 'app', { react: '19.0.0', 'left-pad': '1.3.0', 'is-odd': '3.0.0' });
    expect(result).toEqual({ candidates: [], skipped: [] });
    expect(registry.asked).toEqual([]);
  });
});

describe('references that cannot be resolved', () => {
  it.each([
    ['catalog: {is-odd: ^2.0.0}', 'catalog:', "no entry for 'left-pad' in catalog 'default'"],
    ['catalog: {left-pad: ^1.1.0}', 'catalog:old', "no catalog 'old'"],
    [
      'catalog: {left-pad: ^1.1.0}\ncatalogs: {default: {left-pad: ^1.0.0}}',
      'catalog:',
      "catalog 'default' is defined twice (catalog and catalogs.default)",
    ],
    [undefined, 'catalog:', 'pnpm-workspace.yaml is missing or not valid YAML'],
    ['catalog: {left-pad: ^1.1.0', 'catalog:', 'pnpm-workspace.yaml is missing or not valid YAML'],
  ])('CAT-08 %s / %s', async (workspace, reference, detail) => {
    const root = repo(workspace === undefined ? undefined : `packages: ["packages/*"]\n${workspace}\n`, {
      'left-pad': reference,
    });
    // Without a workspace file the lockfile still makes this a pnpm repository.
    const { result, registry } = await scanModuleOf(root, 'app', { 'left-pad': '1.3.0' });
    expect(result.candidates).toEqual([]);
    expect(result.skipped).toEqual([
      { identifier: 'left-pad', origin: 'public', reason: 'catalog-unresolved', detail },
    ]);
    expect(registry.asked).toEqual([]);
  });

  it('CAT-09 The reason is explained in the output', () => {
    expect(
      describeSkip({ identifier: 'left-pad', origin: 'public', reason: 'catalog-unresolved', detail: "no catalog 'old'" }),
    ).toBe("catalog entry could not be resolved (no catalog 'old')");
  });
});

describe('writing a catalog entry', () => {
  it.each([
    ['left-pad: ^1.1.0', 'left-pad: ^1.3.0'],
    ['left-pad: "^1.1.0"', 'left-pad: "^1.3.0"'],
    ["left-pad: '^1.1.0'", "left-pad: '^1.3.0'"],
    ['left-pad: ^1.1.0   # keep this comment', 'left-pad: ^1.3.0   # keep this comment'],
    ['"left-pad": ^1.1.0', '"left-pad": ^1.3.0'],
    ['catalog: {left-pad: ^1.1.0, is-odd: ^2.0.0}', 'catalog: {left-pad: ^1.3.0, is-odd: ^2.0.0}'],
  ])('CAT-10 The entry is replaced in place: %s', (before, after) => {
    const flow = before.startsWith('catalog:');
    const source = flow ? `packages: [a]\n${before}\n` : `packages: [a]\ncatalog:\n  # c\n  ${before}\n  other: ^2.0.0\n`;
    const expected = flow ? `packages: [a]\n${after}\n` : `packages: [a]\ncatalog:\n  # c\n  ${after}\n  other: ^2.0.0\n`;
    expect(setCatalogRange(source, 'default', 'left-pad', '^1.3.0')).toBe(expected);
  });

  it('throws for a missing entry', () => {
    expect(() => setCatalogRange('catalog: {a: ^1.0.0}\n', 'default', 'b', '^1.0.0')).toThrow();
  });

  function catalogCandidate(root: string): UpdateCandidate {
    return {
      ...npmCandidate('left-pad', '^1.1.0', '^1.3.0'),
      declaration: {
        file: join(root, 'pnpm-workspace.yaml'),
        kind: 'catalog',
        catalogName: 'default',
        displayPath: 'pnpm-workspace.yaml',
      },
    };
  }

  it('CAT-11 Windows line endings and the final line break are kept', async () => {
    const source = 'packages:\r\n  - "packages/*"\r\ncatalog:\r\n  left-pad: ^1.1.0\r\n';
    const root = repo(source, { 'left-pad': 'catalog:' });
    const mod = npmModule(join(root, 'packages', 'app'), 'app', false);
    await new NpmUpdaterAdapter().applyUpdates(mod, root, [catalogCandidate(root)], () => {});
    expect(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')).toBe(source.replace('^1.1.0', '^1.3.0'));
  });

  it('CAT-12 The package.json of the module is not touched and install is not frozen', async () => {
    const root = repo(WS('catalog: {left-pad: ^1.1.0}'), { 'left-pad': 'catalog:' });
    const manifest = readFileSync(join(root, 'packages/app/package.json'), 'utf8');
    const mod = npmModule(join(root, 'packages', 'app'), 'app', false);
    await new NpmUpdaterAdapter().applyUpdates(mod, root, [catalogCandidate(root)], () => {});
    expect(readFileSync(join(root, 'packages/app/package.json'), 'utf8')).toBe(manifest);
    expect(process_.runCommand).toHaveBeenCalledWith(
      'pnpm',
      ['install', '--no-frozen-lockfile'],
      expect.objectContaining({ cwd: root }),
    );
  });

  it('CAT-13 The workspace file is restored by a rollback', async () => {
    const root = repo(WS('catalog: {left-pad: ^1.1.0}'), { 'left-pad': 'catalog:' });
    const before = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
    process_.runCommand.mockImplementation(async (_c: string, args: string[]) =>
      args[0] === 'install' && args.includes('--no-frozen-lockfile')
        ? { exitCode: 1, stdout: 'ERR', stderr: '', timedOut: false }
        : ok,
    );
    const mod = npmModule(join(root, 'packages', 'app'), 'app', false);
    const summary = await runUpdateWorkflow(EcosystemFactory.getStrategy('npm'), mod, root, [catalogCandidate(root)]);
    expect(summary.rolledBack).toBe(true);
    expect(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')).toBe(before);
  });

  it('CAT-14 An entry used by several modules is offered to each and changed once', async () => {
    const root = repo(WS('catalog: {left-pad: ^1.1.0}'), { 'left-pad': 'catalog:' });
    const app = await scanModuleOf(root, 'app', { 'left-pad': '1.3.0' });
    const web = await scanModuleOf(root, 'web', { 'left-pad': '1.3.0' });
    expect(app.result.candidates[0]).toMatchObject({ newRange: '^1.3.0', sharedWith: ['web'] });
    expect(web.result.candidates[0]).toMatchObject({ newRange: '^1.3.0', sharedWith: ['app'] });

    await new NpmUpdaterAdapter().applyUpdates(app.module, root, [app.result.candidates[0]!], () => {});
    expect(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')).toContain('left-pad: ^1.3.0');
    const again = await scanModuleOf(root, 'web', { 'left-pad': '1.3.0' });
    expect(again.result.candidates).toEqual([]);
  });
});
