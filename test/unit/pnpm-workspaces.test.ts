import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';

const process_ = vi.hoisted(() => ({ runCommand: vi.fn() }));
vi.mock('../../src/adapters/shared/process.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/adapters/shared/process.js')>();
  return { ...actual, runCommand: process_.runCommand };
});

import { NpmModuleDiscoveryAdapter } from '../../src/adapters/npm/npm-discovery.js';
import { NpmEcosystemStrategy } from '../../src/adapters/npm/npm-strategy.js';
import { readPnpmWorkspace } from '../../src/adapters/npm/pnpm-workspace.js';
import { findRepositoryRoot } from '../../src/config.js';
import { handleModulesCommand } from '../../src/cli/command-modules.js';
import { cleanupTemp, copyFixture, makeTree } from '../helpers.js';

beforeEach(() => process_.runCommand.mockReset());
afterEach(cleanupTemp);

const LOCK = "lockfileVersion: '9.0'";
const pkg = (name: string, version = '1.0.0') => JSON.stringify({ name, version });
const ids = async (root: string) => (await new NpmModuleDiscoveryAdapter().discover(root)).map((m) => m.id);

describe('modules of a pnpm workspace', () => {
  it('PWS-01 Packages matched by the patterns are modules', async () => {
    const root = makeTree({
      'package.json': '{"name": "mono", "version": "0.0.0", "private": true}',
      'pnpm-workspace.yaml': 'packages: ["packages/*"]',
      'pnpm-lock.yaml': LOCK,
      'packages/core/package.json': pkg('@acme/core', '1.2.0'),
      'packages/cli/package.json': pkg('@acme/cli', '2.0.0'),
      'apps/web/package.json': pkg('@acme/web', '3.0.0'),
    });
    const modules = await new NpmModuleDiscoveryAdapter().discover(root);
    expect(modules.map((m) => [m.id, m.relPath, m.isRoot, m.version, m.ecosystem])).toEqual([
      ['mono', 'Root', true, '0.0.0', 'npm'],
      ['@acme/cli', 'packages/cli', false, '2.0.0', 'npm'],
      ['@acme/core', 'packages/core', false, '1.2.0', 'npm'],
    ]);
  });

  it('PWS-02 A double star matches any depth', async () => {
    const root = makeTree({
      'package.json': '{"name": "mono", "private": true}',
      'pnpm-workspace.yaml': 'packages: ["packages/**"]',
      'pnpm-lock.yaml': LOCK,
      'packages/a/package.json': pkg('a'),
      'packages/deep/x/package.json': pkg('x'),
    });
    expect(await ids(root)).toEqual(['mono', 'a', 'x']);
  });

  it('PWS-03 A pattern starting with ! excludes directories', async () => {
    const root = makeTree({
      'package.json': '{"name": "mono", "private": true}',
      'pnpm-workspace.yaml': 'packages: ["packages/**", "!packages/deep/**"]',
      'pnpm-lock.yaml': LOCK,
      'packages/a/package.json': pkg('a'),
      'packages/deep/x/package.json': pkg('x'),
    });
    expect(await ids(root)).toEqual(['mono', 'a']);
  });

  it('PWS-04 The root is a module even when the patterns do not match it', async () => {
    const root = makeTree({
      'package.json': '{"name": "mono", "version": "1.0.0", "private": true}',
      'pnpm-workspace.yaml': 'packages: ["apps/*"]',
      'pnpm-lock.yaml': LOCK,
      'apps/web/package.json': pkg('web'),
    });
    const modules = await new NpmModuleDiscoveryAdapter().discover(root);
    expect(modules[0]).toMatchObject({ id: 'mono', relPath: 'Root', isRoot: true });
    expect(modules[1]!.id).toBe('web');
  });

  it.each(['catalog: {left-pad: ^1.1.0}', 'packages: []'])(
    'PWS-05 Without a usable packages list the root is the only module: %s',
    async (content) => {
      const root = makeTree({
        'package.json': '{"name": "mono", "private": true}',
        'pnpm-workspace.yaml': content,
        'pnpm-lock.yaml': LOCK,
        'packages/a/package.json': pkg('a'),
      });
      expect(await ids(root)).toEqual(['mono']);
    },
  );

  it('PWS-06 Directories named node_modules never contain modules', async () => {
    const root = makeTree({
      'package.json': '{"name": "mono", "private": true}',
      'pnpm-workspace.yaml': 'packages: ["**"]',
      'pnpm-lock.yaml': LOCK,
      'packages/a/package.json': pkg('a'),
      'packages/a/node_modules/dep/package.json': pkg('dep'),
      'node_modules/other/package.json': pkg('other'),
    });
    expect(await ids(root)).toEqual(['mono', 'a']);
  });

  it('PWS-07 The workspaces field of package.json is ignored in a pnpm repository', async () => {
    const root = makeTree({
      'package.json': '{"name": "mono", "private": true, "workspaces": ["libs/*"]}',
      'pnpm-workspace.yaml': 'packages: ["packages/*"]',
      'pnpm-lock.yaml': LOCK,
      'libs/l/package.json': pkg('l'),
      'packages/a/package.json': pkg('a'),
    });
    expect(await ids(root)).toEqual(['mono', 'a']);
  });

  it('PWS-08 A pnpm-workspace.yaml does not make an npm repository a pnpm repository', async () => {
    const root = makeTree({
      'package.json': '{"name": "mono", "private": true, "packageManager": "npm@10.8.0", "workspaces": ["libs/*"]}',
      'pnpm-workspace.yaml': 'packages: ["packages/*"]',
      'libs/l/package.json': pkg('l'),
      'packages/a/package.json': pkg('a'),
    });
    expect(await ids(root)).toEqual(['mono', 'l']);
  });

  it('PWS-09 A pnpm-workspace.yaml that is not valid YAML leaves the root as the only module', async () => {
    const root = makeTree({
      'package.json': '{"name": "mono", "private": true}',
      'pnpm-workspace.yaml': 'packages: ["packages/*"',
      'pnpm-lock.yaml': LOCK,
      'packages/a/package.json': pkg('a'),
    });
    expect(await ids(root)).toEqual(['mono']);
  });

  it('PWS-00 The fixture is discovered', async () => {
    expect(await ids(copyFixture('pnpm-workspaces'))).toEqual(['mono', '@acme/app', '@acme/lib']);
  });
});

describe('repository root of a pnpm workspace', () => {
  const root = (files: Record<string, string>) => makeTree({ '.git/HEAD': 'ref: refs/heads/main', ...files });

  it('PWS-10 A pnpm workspace package resolves to the workspace root', () => {
    const top = root({
      'package.json': '{"name": "mono", "private": true}',
      'pnpm-workspace.yaml': 'packages: ["packages/*"]',
      'packages/core/package.json': pkg('core'),
    });
    expect(findRepositoryRoot(join(top, 'packages', 'core'))).toBe(top);
  });

  it('PWS-11 A workspace file with only settings still marks the root', () => {
    const top = root({
      'package.json': pkg('app'),
      'pnpm-workspace.yaml': 'catalog: {left-pad: ^1.1.0}',
      'src/index.js': '',
    });
    expect(findRepositoryRoot(join(top, 'src'))).toBe(top);
  });

  it('PWS-12 An unreadable workspace file on the way up is skipped', () => {
    const top = root({
      'package.json': '{"name": "mono", "private": true}',
      'pnpm-workspace.yaml': 'packages: ["packages/*"]',
      'packages/pnpm-workspace.yaml': 'packages: [unclosed',
      'packages/core/package.json': pkg('core'),
    });
    expect(findRepositoryRoot(join(top, 'packages', 'core'))).toBe(top);
  });

  it('PWS-13 A workspace file above the checkout is ignored', () => {
    const top = makeTree({
      'pnpm-workspace.yaml': 'packages: ["checkout/*"]',
      'checkout/.git/HEAD': 'ref: refs/heads/main',
      'checkout/app/package.json': pkg('app'),
    });
    const app = join(top, 'checkout', 'app');
    expect(findRepositoryRoot(app)).toBe(app);
  });
});

describe('the package manager in the module listing', () => {
  const PNPM_TREE = {
    'package.json': '{"name": "mono", "private": true}',
    'pnpm-workspace.yaml': 'packages: ["packages/*"]',
    'pnpm-lock.yaml': LOCK,
    'packages/a/package.json': pkg('a'),
  };

  async function run(files: Record<string, string>, json: boolean) {
    const top = makeTree(files);
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => void lines.push(args.join(' ')));
    try {
      await handleModulesCommand({ json, ecosystem: 'npm' } as any, { rootDir: top } as any);
    } finally {
      spy.mockRestore();
    }
    return lines.join('\n');
  }

  it('PWS-14 The module listing says that the repository is managed by pnpm', async () => {
    const parsed = JSON.parse(await run(PNPM_TREE, true));
    expect(parsed).toMatchObject({ ecosystem: 'npm', packageManager: 'pnpm' });
    const text = await run(PNPM_TREE, false);
    expect(text.split('\n').find((l) => l.includes('Discovered'))).toBe('🪶 Discovered 📦 Node / pnpm Modules (2):');
  });

  it('PWS-15 A repository without pnpm evidence reports npm', async () => {
    const parsed = JSON.parse(
      await run({ 'package.json': '{"name": "mono", "version": "1.0.0"}', 'package-lock.json': '{}' }, true),
    );
    expect(parsed).toMatchObject({ ecosystem: 'npm', packageManager: 'npm' });
  });

  it('PWS-16 The strategy reports the package manager of an npm ecosystem only', () => {
    const top = makeTree(PNPM_TREE);
    const strategy = new NpmEcosystemStrategy();
    expect(strategy.packageManagerFor(top)).toBe('pnpm');
    expect(strategy.displayNameFor(top)).toBe('Node / pnpm');
  });
});

describe('readPnpmWorkspace', () => {
  it('reads packages and catalogs, and flags an ambiguous default catalog', () => {
    const top = makeTree({
      'pnpm-workspace.yaml': 'packages: [a]\ncatalog: {x: ^1.0.0}\ncatalogs:\n  default: {x: ^2.0.0}\n  old: {y: ^1.0.0}\n',
    });
    const ws = readPnpmWorkspace(top)!;
    expect(ws.packages).toEqual(['a']);
    expect(ws.ambiguousDefaultCatalog).toBe(true);
    expect(ws.catalogs.get('old')!.get('y')).toBe('^1.0.0');
  });

  it('is undefined for a missing or invalid file', () => {
    expect(readPnpmWorkspace(makeTree({}))).toBeUndefined();
    expect(readPnpmWorkspace(makeTree({ 'pnpm-workspace.yaml': 'packages: [unclosed' }))).toBeUndefined();
  });
});
