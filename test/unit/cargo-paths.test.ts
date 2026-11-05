import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const process_ = vi.hoisted(() => ({ runCommand: vi.fn() }));
vi.mock('../../src/adapters/shared/process.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/adapters/shared/process.js')>()),
  runCommand: process_.runCommand,
}));

import { CargoModuleDiscoveryAdapter } from '../../src/adapters/cargo/cargo-discovery.js';
import { CargoUpdaterAdapter } from '../../src/adapters/cargo/cargo-updater.js';
import { CargoVerificationAdapter } from '../../src/adapters/cargo/cargo-verifier.js';
import type { UpdateCandidate } from '../../src/domain/models.js';
import { cleanupTemp, makeTree } from '../helpers.js';

const IS_WINDOWS = process.platform === 'win32';
const hasCargo = (() => {
  try {
    execSync('cargo --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

afterEach(cleanupTemp);
beforeEach(() => process_.runCommand.mockReset());

/** Records every call; ignores the argument-less call vitest makes when it resets a mock. */
function record(answer: (args: string[], cwd: string) => string) {
  const calls: { args: string[]; cwd: string }[] = [];
  process_.runCommand.mockImplementation(async (...call: any[]) => {
    if (!call.length) return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
    calls.push({ args: call[1], cwd: call[2].cwd });
    return { exitCode: 0, stdout: answer(call[1], call[2].cwd), stderr: '', timedOut: false };
  });
  return calls;
}

const LOCK = '[[package]]\nname = "itoa"\nversion = "0.4.8"\n';

describe('WIN: Cargo never puts the repository path on a command line', () => {
  it('CWIN-01 discovery, update and verification pass only the working directory, not the path', async () => {
    const root = makeTree({
      'R&D 100%/Cargo.toml': '[package]\nname="x"\n[dependencies]\nitoa = "0.4"\n',
      'R&D 100%/Cargo.lock': LOCK,
      'R&D 100%/src/main.rs': '',
    });
    const dir = join(root, 'R&D 100%');
    const metadata = JSON.stringify({
      workspace_root: dir,
      packages: [{ name: 'x', version: '0.1.0', manifest_path: join(dir, 'Cargo.toml'), rust_version: null, dependencies: [] }],
    });
    const calls = record((args) => (args[0] === 'metadata' ? metadata : ''));

    const [module] = await new CargoModuleDiscoveryAdapter().discover(dir);
    const update = {
      coordinate: { identifier: 'itoa', artifact: 'itoa', ecosystem: 'cargo' },
      currentRange: '0.4', currentClean: '0.4.0', latest: '1.0.18', newRange: '1.0', diff: 'major', scope: 'prod', selected: true,
      origin: { kind: 'public' }, action: 'update',
      declaration: { file: join(dir, 'Cargo.toml'), kind: 'dependency', displayPath: 'Cargo.toml' },
    } as UpdateCandidate;
    await new CargoUpdaterAdapter().applyUpdates(module!, dir, [update], () => {});
    await new CargoVerificationAdapter().verify(module!, dir, { changedFiles: [join(dir, 'Cargo.toml')] });

    expect(calls.map((c) => c.args[0])).toEqual(['metadata', 'update', 'metadata', 'check']);
    for (const call of calls) {
      expect(call.cwd).toBe(dir);
      expect(call.args.join(' ')).not.toMatch(/[&%]|R&D|\/tmp|elevate-tree/);
    }
  });

  it('CWIN-02 crate names and versions with + and @ are accepted by the command runner', async () => {
    const actual = await vi.importActual<typeof import('../../src/adapters/shared/process.js')>('../../src/adapters/shared/process.js');
    // The quoting rule exists on Windows only; elsewhere this proves such arguments pass through unchanged.
    await expect(actual.runCommand('node', ['-e', '0', 'itoa@1.0.18+x', 'serde_json@1.0.0+build.5'], { cwd: process.cwd() })).resolves.toMatchObject({ exitCode: 0 });
  });
});

describe.skipIf(!IS_WINDOWS || !hasCargo)('WIN: real cargo in a directory with special characters (@windows)', () => {
  it('CWIN-03 a repository below a path containing & is discovered', async () => {
    const root = makeTree({ 'R&D/Cargo.toml': '[package]\nname="x"\nversion="0.1.0"\nedition="2021"\n', 'R&D/src/main.rs': 'fn main(){}\n' });
    const actual = await vi.importActual<typeof import('../../src/adapters/shared/process.js')>('../../src/adapters/shared/process.js');
    // Vitest also invokes the implementation without arguments when it resets the mock.
    process_.runCommand.mockImplementation((...call: Parameters<typeof actual.runCommand>) =>
      call.length ? actual.runCommand(...call) : Promise.resolve({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
    );
    const modules = await new CargoModuleDiscoveryAdapter().discover(join(root, 'R&D'));
    expect(modules.map((m) => m.id)).toEqual(['x']);
  });
});
