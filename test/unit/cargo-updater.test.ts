import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const process_ = vi.hoisted(() => ({ runCommand: vi.fn() }));
vi.mock('../../src/adapters/shared/process.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/adapters/shared/process.js')>()),
  runCommand: process_.runCommand,
}));

import { CargoUpdaterAdapter } from '../../src/adapters/cargo/cargo-updater.js';
import { readLockedVersions } from '../../src/adapters/cargo/cargo-lockfile.js';
import { InstallError } from '../../src/domain/ports.js';
import type { ProjectModule, UpdateCandidate } from '../../src/domain/models.js';
import { cleanupTemp, makeTree } from '../helpers.js';

const lock = (...pkgs: [string, string][]) =>
  pkgs.map(([name, version]) => `[[package]]\nname = "${name}"\nversion = "${version}"\n`).join('\n');

function candidate(
  name: string,
  currentRange: string,
  newRange: string,
  declaration: { file: string; kind: 'dependency' | 'dependency-management' },
  latest = newRange,
): UpdateCandidate {
  return {
    coordinate: { identifier: name, artifact: name, ecosystem: 'cargo' },
    currentRange,
    currentClean: currentRange,
    latest,
    newRange,
    diff: 'minor',
    scope: 'prod',
    selected: true,
    origin: { kind: 'public' },
    action: 'update',
    declaration: { ...declaration, displayPath: 'x' },
  };
}

function setup(files: Record<string, string>) {
  const root = makeTree({ 'a/src/main.rs': '', ...files });
  const module: ProjectModule = { id: 'a', name: 'a', path: join(root, 'a'), relPath: 'a', ecosystem: 'cargo', isRoot: false, aggregatorDir: root };
  return { root, module, member: join(root, 'a/Cargo.toml'), rootManifest: join(root, 'Cargo.toml'), lockFile: join(root, 'Cargo.lock') };
}

/** Pretends to be `cargo update`: moves locked crates to the version the manifest now allows. */
function fakeCargo(lockFile: string, newest: Record<string, string>) {
  const calls: string[][] = [];
  process_.runCommand.mockImplementation(async (...a: any[]) => {
    const args = a[1] as string[] | undefined;
    // Vitest also invokes the implementation without arguments when it resets the mock.
    if (!args) return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
    calls.push(args);
    const spec = args[args.indexOf('-p') + 1]!;
    const [name] = spec.split('@');
    const precise = args.includes('--precise') ? args[args.indexOf('--precise') + 1]! : newest[name!]!;
    writeFileSync(lockFile, lock([name!, precise]));
    return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
  });
  return calls;
}

const updater = new CargoUpdaterAdapter();
const progress = () => {};

beforeEach(() => process_.runCommand.mockReset());
afterEach(cleanupTemp);

describe('Cargo updater', () => {
  it('CUPD-01 only the version text changes', async () => {
    const t = setup({ 'a/Cargo.toml': '# keep me\n[dependencies]\nlog = \'0.4.10\' # note\nitoa = { version = "1.0.0", features = ["std"] }\n' });
    await updater.applyUpdates(t.module, t.root, [
      candidate('log', '0.4.10', '0.4.35', { file: t.member, kind: 'dependency' }),
      candidate('itoa', '1.0.0', '1.0.18', { file: t.member, kind: 'dependency' }),
    ], progress);
    expect(readFileSync(t.member, 'utf8')).toBe('# keep me\n[dependencies]\nlog = \'0.4.35\' # note\nitoa = { version = "1.0.18", features = ["std"] }\n');
  });

  it('CUPD-02 an inherited dependency is changed in the workspace root, not in the member', async () => {
    const rootToml = '[workspace]\nmembers=["a"]\n[workspace.dependencies]\nserde = { version = "1.0.100", features = ["derive"] }\n';
    const memberToml = '[dependencies]\nserde = { workspace = true }\n';
    const t = setup({ 'Cargo.toml': rootToml, 'a/Cargo.toml': memberToml });
    const update = candidate('serde', '1.0.100', '1.0.229', { file: t.rootManifest, kind: 'dependency-management' });
    expect(updater.affectedFiles(t.module, t.root, [update])).toEqual(expect.arrayContaining([t.rootManifest, t.lockFile]));
    await updater.applyUpdates(t.module, t.root, [update], progress);
    expect(readFileSync(t.rootManifest, 'utf8')).toBe(rootToml.replace('1.0.100', '1.0.229'));
    expect(readFileSync(t.member, 'utf8')).toBe(memberToml);
  });

  it('CUPD-03 a manifest that changed since the scan is refused before anything is written or run', async () => {
    const original = '[dependencies]\nlog = "0.4.99"\n';
    const t = setup({ 'a/Cargo.toml': original, 'Cargo.lock': lock(['log', '0.4.99']) });
    await expect(
      updater.applyUpdates(t.module, t.root, [candidate('log', '0.4.10', '0.4.35', { file: t.member, kind: 'dependency' })], progress),
    ).rejects.toBeInstanceOf(InstallError);
    expect(readFileSync(t.member, 'utf8')).toBe(original);
    expect(process_.runCommand).not.toHaveBeenCalled();
  });

  it('CUPD-04 the lockfile follows the manifest', async () => {
    const t = setup({ 'a/Cargo.toml': '[dependencies]\nitoa = "0.4"\n', 'Cargo.lock': lock(['itoa', '0.4.8']) });
    const calls = fakeCargo(t.lockFile, { itoa: '1.0.18' });
    await updater.applyUpdates(t.module, t.root, [candidate('itoa', '0.4', '2', { file: t.member, kind: 'dependency' }, '2.0.0')], progress);
    expect(calls).toEqual([['update', '-p', 'itoa@0.4.8']]);
  });

  it('CUPD-13 a version picked below the newest is pinned exactly', async () => {
    const t = setup({ 'a/Cargo.toml': '[dependencies]\nitoa = "0.4"\n', 'Cargo.lock': lock(['itoa', '0.4.8']) });
    const calls = fakeCargo(t.lockFile, { itoa: '1.0.18' });
    await updater.applyUpdates(t.module, t.root, [candidate('itoa', '0.4', '1.0.15', { file: t.member, kind: 'dependency' }, '1.0.15')], progress);
    expect(calls).toEqual([
      ['update', '-p', 'itoa@0.4.8'],
      ['update', '-p', 'itoa@1.0.18', '--precise', '1.0.15'],
    ]);
    expect(readLockedVersions(t.lockFile).get('itoa')).toEqual(['1.0.15']);
  });

  it('CUPD-05 without a Cargo.lock none is created and cargo is not run', async () => {
    const t = setup({ 'a/Cargo.toml': '[dependencies]\nlog = "0.4.10"\n' });
    await updater.applyUpdates(t.module, t.root, [candidate('log', '0.4.10', '0.4.35', { file: t.member, kind: 'dependency' })], progress);
    expect(process_.runCommand).not.toHaveBeenCalled();
    expect(existsSync(t.lockFile)).toBe(false);
  });

  it('CUPD-06 a failing cargo update is an InstallError carrying cargo\'s output', async () => {
    const t = setup({ 'a/Cargo.toml': '[dependencies]\nlog = "0.4.10"\n', 'Cargo.lock': lock(['log', '0.4.10']) });
    process_.runCommand.mockResolvedValue({ exitCode: 101, stdout: '', stderr: 'error: failed to select a version', timedOut: false });
    await expect(
      updater.applyUpdates(t.module, t.root, [candidate('log', '0.4.10', '0.4.35', { file: t.member, kind: 'dependency' })], progress),
    ).rejects.toThrow(InstallError);
  });

  it('CUPD-07 a crate declared in several sections with the same requirement gets the new one everywhere', async () => {
    const t = setup({ 'a/Cargo.toml': '[dependencies]\ntokio = "1.0.0"\n[dev-dependencies]\ntokio = { version = "1.0.0", features = ["test-util"] }\n' });
    await updater.applyUpdates(t.module, t.root, [candidate('tokio', '1.0.0', '1.40.0', { file: t.member, kind: 'dependency' })], progress);
    expect(readFileSync(t.member, 'utf8')).toBe('[dependencies]\ntokio = "1.40.0"\n[dev-dependencies]\ntokio = { version = "1.40.0", features = ["test-util"] }\n');
  });

  it('CALIGN-03 a path alignment edits the version literal and touches no lockfile', async () => {
    const t = setup({ 'a/Cargo.toml': '[dependencies]\nb = { path = "../b", version = "0.1" }\n', 'Cargo.lock': lock(['b', '0.1.0']) });
    const update = { ...candidate('b', '0.1', '0.2', { file: t.member, kind: 'dependency' }, '0.2.0'), action: 'align' as const, origin: { kind: 'workspace' as const, moduleId: 'b', moduleRelPath: 'b' } };
    await updater.applyUpdates(t.module, t.root, [update], progress);
    expect(readFileSync(t.member, 'utf8')).toContain('version = "0.2"');
    expect(process_.runCommand).not.toHaveBeenCalled();
  });

  it('CUPD-08 a crate locked in two versions is addressed by the version its requirement resolved to', async () => {
    const t = setup({ 'a/Cargo.toml': '[dependencies]\nitoa = "0.4"\n', 'Cargo.lock': lock(['itoa', '1.0.15'], ['itoa', '0.4.8']) });
    const calls = fakeCargo(t.lockFile, { itoa: '1.0.18' });
    await updater.applyUpdates(t.module, t.root, [candidate('itoa', '0.4', '2', { file: t.member, kind: 'dependency' }, '2.0.0')], progress);
    expect(calls[0]).toEqual(['update', '-p', 'itoa@0.4.8']);
  });
});
