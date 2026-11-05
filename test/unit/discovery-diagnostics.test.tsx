import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { join } from 'node:path';

const process_ = vi.hoisted(() => ({ runCommand: vi.fn() }));
vi.mock('../../src/adapters/shared/process.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/adapters/shared/process.js')>()),
  runCommand: process_.runCommand,
}));

import { CargoModuleDiscoveryAdapter } from '../../src/adapters/cargo/cargo-discovery.js';
import { discoverModules } from '../../src/application/scan.js';
import { WorkspaceBar } from '../../src/components/workspace-bar.js';
import { handleModulesCommand } from '../../src/cli/command-modules.js';
import { EcosystemFactory } from '../../src/domain/ecosystem-factory.js';
import { en } from '../../src/i18n/locales/en.js';
import type { ProjectModule } from '../../src/domain/models.js';
import { cleanupTemp, makeTree } from '../helpers.js';

afterEach(() => {
  cleanupTemp();
  vi.restoreAllMocks();
});

const out = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', timedOut: false });
const fail = (stderr: string) => ({ exitCode: 101, stdout: '', stderr, timedOut: false });
const metadata = (dir: string, name: string) =>
  JSON.stringify({ workspace_root: dir, packages: [{ name, version: '1.0.0', manifest_path: join(dir, 'Cargo.toml'), rust_version: null, dependencies: [] }] });

function twoWorkspaces() {
  const root = makeTree({ 'good/Cargo.toml': '', 'bad/Cargo.toml': '' });
  const good = join(root, 'good');
  process_.runCommand.mockImplementation(async (...call: any[]) => {
    const cwd = call[2]?.cwd;
    if (cwd === good) return out(metadata(good, 'good'));
    return fail('error: registry index was not found in any configuration: `corp`');
  });
  return root;
}

describe('discovery diagnostics', () => {
  it('CDISC-16 a failing workspace is reported next to the modules that were found', async () => {
    const root = twoWorkspaces();
    const discovery = new CargoModuleDiscoveryAdapter();
    expect((await discovery.discover(root)).map((m) => m.id)).toEqual(['good']);
    expect(discovery.diagnostics()).toEqual([expect.stringMatching(/bad.*registry index was not found.*corp/s)]);
  });

  it('CDISC-12 diagnostics start empty on every run', async () => {
    const root = twoWorkspaces();
    const discovery = new CargoModuleDiscoveryAdapter();
    await discovery.discover(root);
    process_.runCommand.mockImplementation(async (...call: any[]) => out(metadata(call[2]?.cwd ?? root, 'x')));
    await discovery.discover(root);
    expect(discovery.diagnostics()).toEqual([]);
  });

  it('CDISC-13 discoverModules returns modules and diagnostics; adapters without diagnostics give none', async () => {
    const root = twoWorkspaces();
    const cargo = await discoverModules(EcosystemFactory.getStrategy('cargo'), root);
    expect(cargo.modules.map((m) => m.id)).toEqual(['good']);
    expect(cargo.diagnostics).toHaveLength(1);

    const npm = await discoverModules(EcosystemFactory.getStrategy('npm'), makeTree({ 'package.json': '{"name":"r"}' }));
    expect(npm.diagnostics).toEqual([]);
  });

  it('CDISC-14 modules --json carries the diagnostics and the text output prints them to stderr', async () => {
    const root = twoWorkspaces();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await handleModulesCommand({ ecosystem: 'cargo', json: true } as any, { rootDir: root } as any);
    expect(JSON.parse(String(log.mock.calls[0]![0])).diagnostics).toHaveLength(1);

    log.mockClear();
    await handleModulesCommand({ ecosystem: 'cargo' } as any, { rootDir: root } as any);
    expect(String(err.mock.calls[0]![0])).toMatch(/registry index was not found/);
  });

  it('CUI-04 the workspace bar shows what discovery could not load', () => {
    const module: ProjectModule = { id: 'good', name: 'good', path: '/r/good', relPath: 'good', ecosystem: 'cargo', isRoot: false };
    const { lastFrame } = render(
      <WorkspaceBar module={module} internalScopes={[]} strategy={EcosystemFactory.getStrategy('cargo')} t={en} diagnostics={['cargo metadata failed in /r/bad: error: broken']} />,
    );
    expect(lastFrame()).toContain('cargo metadata failed in /r/bad');
  });
});
