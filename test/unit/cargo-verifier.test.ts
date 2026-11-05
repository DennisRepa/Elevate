import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';

const process_ = vi.hoisted(() => ({ runCommand: vi.fn(), runShellScript: vi.fn() }));
vi.mock('../../src/adapters/shared/process.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/adapters/shared/process.js')>()),
  runCommand: process_.runCommand,
  runShellScript: process_.runShellScript,
}));

import { CargoVerificationAdapter, planCheck } from '../../src/adapters/cargo/cargo-verifier.js';
import type { CargoMetadata, MetadataDependency } from '../../src/adapters/cargo/cargo-metadata.js';
import type { ProjectModule } from '../../src/domain/models.js';

const ROOT = join('/repo');
const manifest = (dir: string) => join(ROOT, dir, 'Cargo.toml');
const pathDep = (name: string): MetadataDependency => ({ name, req: '*', kind: null, rename: null, source: null, path: join(ROOT, name), target: null, optional: false });
const pkg = (name: string, ...deps: MetadataDependency[]) => ({ name, version: '1.0.0', manifest_path: manifest(name), rust_version: null, dependencies: deps });

// core <- api <- app ; util is unrelated
const metadata: CargoMetadata = {
  workspace_root: ROOT,
  packages: [pkg('core'), pkg('api', pathDep('core')), pkg('app', pathDep('api')), pkg('util')],
};
const mod = (name: string): ProjectModule => ({ id: name, name, path: join(ROOT, name), relPath: name, ecosystem: 'cargo', isRoot: false, aggregatorDir: ROOT });

describe('Cargo verification plan', () => {
  it('CVER-01 checks the changed member and everything that depends on it', () => {
    expect(planCheck(metadata, mod('core'), [manifest('core')], false)).toEqual(['check', '--all-targets', '-p', 'core', '-p', 'api', '-p', 'app']);
    expect(planCheck(metadata, mod('util'), [manifest('util')], false)).toEqual(['check', '--all-targets', '-p', 'util']);
  });

  it('CVER-02 a changed workspace root manifest checks the whole workspace', () => {
    expect(planCheck(metadata, mod('core'), [manifest('core'), join(ROOT, 'Cargo.toml')], false)).toEqual(['check', '--all-targets', '--workspace']);
  });

  it('CVER-09 without information about changes the module itself is checked', () => {
    expect(planCheck(metadata, mod('api'), [], false)).toEqual(['check', '--all-targets', '-p', 'api', '-p', 'app']);
  });

  it('CVER-03 --locked is used only when a Cargo.lock existed', () => {
    expect(planCheck(metadata, mod('util'), [manifest('util')], true)).toEqual(['check', '--all-targets', '--locked', '-p', 'util']);
  });
});

describe('Cargo verifier', () => {
  beforeEach(() => {
    process_.runCommand.mockReset();
    process_.runShellScript.mockReset();
  });
  const ok = { exitCode: 0, stdout: '', stderr: '', timedOut: false };
  const verifier = new CargoVerificationAdapter({ loadMetadata: async () => metadata, hasLock: () => false });

  it('CVER-05 a failed check reports cargo\'s error lines', async () => {
    process_.runCommand.mockImplementation(async (...a: any[]) =>
      a.length ? { exitCode: 101, stdout: '', stderr: 'Checking x\nerror[E0308]: mismatched types\n --> src/lib.rs\nerror: could not compile `x`', timedOut: false } : ok,
    );
    const result = await verifier.verify(mod('util'), ROOT, { changedFiles: [manifest('util')] });
    expect(result.status).toBe('warn');
    expect(result.details).toBe('error[E0308]: mismatched types\nerror: could not compile `x`');
    expect(result.label).toBe('Cargo build (cargo check --all-targets -p util)');
  });

  it('CVER-08 a passing check is clean', async () => {
    process_.runCommand.mockImplementation(async () => ok);
    expect((await verifier.verify(mod('util'), ROOT, {})).status).toBe('clean');
  });

  it('CVER-04 a custom script runs in the workspace root and no cargo check is started', async () => {
    process_.runShellScript.mockImplementation(async () => ok);
    const result = await verifier.verify(mod('util'), ROOT, { customScript: 'just test', customLabel: 'Tests' });
    expect(process_.runShellScript).toHaveBeenCalledWith('just test', expect.objectContaining({ cwd: ROOT }));
    expect(process_.runCommand).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'clean', label: 'Tests' });
  });
});
