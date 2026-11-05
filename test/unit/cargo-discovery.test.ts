import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const process_ = vi.hoisted(() => ({ runCommand: vi.fn() }));
vi.mock('../../src/adapters/shared/process.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/adapters/shared/process.js')>()),
  runCommand: process_.runCommand,
}));

import { CargoModuleDiscoveryAdapter } from '../../src/adapters/cargo/cargo-discovery.js';
import { CargoMetadataError } from '../../src/adapters/cargo/cargo-metadata.js';
import { FIXTURES, cleanupTemp, makeTree } from '../helpers.js';

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', timedOut: false });

/** Minimal `cargo metadata --no-deps` output for a workspace. */
function metadata(root: string, members: { name: string; dir: string; version?: string }[]) {
  const packages = members.map((m) => ({
    name: m.name,
    version: m.version ?? '0.1.0',
    manifest_path: join(m.dir, 'Cargo.toml'),
    rust_version: null,
    dependencies: [],
  }));
  return JSON.stringify({ packages, workspace_root: root, workspace_members: [] });
}

/** Answers `cargo metadata` by the directory it runs in. */
function byCwd(answers: Record<string, ReturnType<typeof ok>>, fallback = ok('{}')) {
  process_.runCommand.mockImplementation(async (_command: string, _args: string[], options?: { cwd: string }) => {
    return answers[options?.cwd ?? ''] ?? fallback;
  });
}

const discovery = new CargoModuleDiscoveryAdapter();

beforeEach(() => process_.runCommand.mockReset());
afterEach(cleanupTemp);

describe('Cargo module discovery', () => {
  it('CDISC-01 a virtual workspace reports its members, with one cargo run and no root module', async () => {
    const root = makeTree({
      'Cargo.toml': '[workspace]\nmembers = ["crates/*", "tools/c"]\n',
      'crates/a/Cargo.toml': '[package]\nname="a"\n',
      'crates/b/Cargo.toml': '[package]\nname="b"\n',
      'tools/c/Cargo.toml': '[package]\nname="c"\n',
    });
    const fixture = readFileSync(join(FIXTURES, 'cargo-metadata/workspace.json'), 'utf8').replaceAll('/repo', root.replaceAll('\\', '/'));
    process_.runCommand.mockResolvedValue(ok(fixture));

    const modules = await discovery.discover(root);

    expect(process_.runCommand).toHaveBeenCalledTimes(1);
    expect(process_.runCommand).toHaveBeenCalledWith('cargo', ['metadata', '--no-deps', '--format-version', '1'], expect.objectContaining({ cwd: root }));
    expect(modules.map((m) => [m.id, m.relPath, m.version, m.isRoot, m.ecosystem])).toEqual([
      ['a', 'crates/a', '0.3.0', false, 'cargo'],
      ['b', 'crates/b', '0.2.0', false, 'cargo'],
      ['c', 'tools/c', '1.0.0', false, 'cargo'],
    ]);
    expect(modules.every((m) => m.aggregatorDir === root)).toBe(true);
  });

  it('CDISC-02 a package at the repository root is the Root module', async () => {
    const root = makeTree({ 'Cargo.toml': '[package]\nname="solo"\n' });
    process_.runCommand.mockResolvedValue(ok(metadata(root, [{ name: 'solo', dir: root, version: '2.0.0' }])));
    const [module] = await discovery.discover(root);
    expect(module).toMatchObject({ id: 'solo', relPath: 'Root', isRoot: true, version: '2.0.0' });
  });

  it('CDISC-05 a workspace below a non-Rust root and a second independent one are both found', async () => {
    const root = makeTree({
      'package.json': '{}',
      'apps/desktop/src-tauri/Cargo.toml': '[package]\nname="app"\n',
      'tools/gen/Cargo.toml': '[package]\nname="gen"\n',
    });
    const tauri = join(root, 'apps/desktop/src-tauri');
    const gen = join(root, 'tools/gen');
    byCwd({
      [tauri]: ok(metadata(tauri, [{ name: 'app', dir: tauri }])),
      [gen]: ok(metadata(gen, [{ name: 'gen', dir: gen }])),
    });
    const modules = await discovery.discover(root);
    expect(modules.map((m) => [m.id, m.relPath, m.aggregatorDir])).toEqual([
      ['app', 'apps/desktop/src-tauri', tauri],
      ['gen', 'tools/gen', gen],
    ]);
  });

  it('CDISC-06 target, node_modules, vendor, hidden folders and src are not searched', async () => {
    const root = makeTree({
      'Cargo.toml': '[package]\nname="solo"\n',
      'target/debug/x/Cargo.toml': '',
      'node_modules/pkg/Cargo.toml': '',
      'vendor/dep/Cargo.toml': '',
      '.hidden/Cargo.toml': '',
      'src/fixture/Cargo.toml': '',
    });
    process_.runCommand.mockResolvedValue(ok(metadata(root, [{ name: 'solo', dir: root }])));
    await discovery.discover(root);
    expect(process_.runCommand).toHaveBeenCalledTimes(1);
  });

  it('CDISC-09 a failing cargo run is reported with cargo\'s own message', async () => {
    const root = makeTree({ 'Cargo.toml': '[package]\nname="x"\n' });
    process_.runCommand.mockResolvedValue({ exitCode: 101, stdout: '', stderr: 'error: registry index was not found in any configuration: `corp`', timedOut: false });
    await expect(discovery.discover(root)).rejects.toThrow(CargoMetadataError);
    await expect(discovery.discover(root)).rejects.toThrow(/registry index was not found.*corp/);
  });

  it('CDISC-15 a failing workspace does not hide the others', async () => {
    const root = makeTree({ 'a/Cargo.toml': '', 'b/Cargo.toml': '' });
    const b = join(root, 'b');
    byCwd({ [b]: ok(metadata(b, [{ name: 'b', dir: b }])) }, { exitCode: 101, stdout: '', stderr: 'error: broken', timedOut: false });
    const modules = await discovery.discover(root);
    expect(modules.map((m) => m.id)).toEqual(['b']);
  });

  it('CDISC-08 the root proposal is the nearest ancestor declaring [workspace], else the nearest with a manifest', () => {
    const ws = makeTree({
      '.git/HEAD': '',
      'Cargo.toml': '[workspace]\nmembers=["crates/a"]\n',
      'crates/a/Cargo.toml': '[package]\nname="a"\n',
      'crates/a/src/x.rs': '',
    });
    expect(discovery.findRoot(join(ws, 'crates/a/src'), ws)).toBe(ws);

    const lone = makeTree({ '.git/HEAD': '', 'lone/Cargo.toml': '[package]\nname="lone"\n', 'lone/src/x.rs': '', 'plain/readme.md': '' });
    expect(discovery.findRoot(join(lone, 'lone/src'), lone)).toBe(join(lone, 'lone'));
    expect(discovery.findRoot(join(lone, 'plain'), lone)).toBeUndefined();
  });

  it('CDISC-11 two independent workspaces with a crate of the same name get distinct ids', async () => {
    const root = makeTree({ 'one/Cargo.toml': '', 'two/Cargo.toml': '' });
    const one = join(root, 'one');
    const two = join(root, 'two');
    byCwd({
      [one]: ok(metadata(one, [{ name: 'utils', dir: one }])),
      [two]: ok(metadata(two, [{ name: 'utils', dir: two }])),
    });
    const modules = await discovery.discover(root);
    expect(modules.map((m) => [m.id, m.name, m.relPath])).toEqual([
      ['utils', 'utils', 'one'],
      ['utils (two)', 'utils', 'two'],
    ]);
  });
});
