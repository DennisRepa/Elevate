/**
 * End-to-end checks with the real Cargo and crates.io. They need `cargo` on
 * the PATH and network access to the sparse index.
 *
 *   npm run test:integration
 */

import { afterAll, describe, expect, it } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EcosystemFactory } from '../../src/domain/ecosystem-factory.js';
import { createScanContext, scanModule } from '../../src/application/scan.js';
import { selectAll } from '../../src/application/update-selection.js';
import { runUpdateWorkflow } from '../../src/application/update-workflow.js';
import { cleanupTemp, makeTree } from '../helpers.js';

afterAll(cleanupTemp);

function hasCargo(): boolean {
  try {
    execSync('cargo --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function cargo(cwd: string, ...args: string[]) {
  const result = spawnSync('cargo', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`cargo ${args.join(' ')} failed:\n${result.stderr}`);
}

/** A workspace whose `itoa` 0.4 and `serde` 1.0.100 are behind, with a Cargo.lock that pins the old itoa. */
function workspace(options: { lock?: boolean; main?: string; config?: string } = {}) {
  const root = makeTree({
    'Cargo.toml': '[workspace]\nresolver = "2"\nmembers = ["x"]\n',
    'x/Cargo.toml': '[package]\nname = "x"\nversion = "0.1.0"\nedition = "2021"\n\n# keep this comment\n[dependencies]\nserde = "1.0.100"\nitoa = "0.4"\n',
    'x/src/main.rs': options.main ?? 'fn main() {}\n',
    ...(options.config ? { '.cargo/config.toml': options.config } : {}),
  });
  if (options.lock !== false) {
    cargo(root, 'generate-lockfile');
    cargo(root, 'update', '-p', 'itoa', '--precise', '0.4.8');
  }
  return root;
}

describe.skipIf(!hasCargo())('Cargo', () => {
  const strategy = EcosystemFactory.getStrategy('cargo');

  async function prepare(root: string) {
    const modules = await strategy.discovery.discover(root);
    const module = modules.find((m) => m.id === 'x')!;
    const context = createScanContext(modules, { rootDir: root, internalScopes: [] }, 'stable');
    const scan = await scanModule(strategy, module, context);
    return { module, scan };
  }

  it('CSCAN-04 scans a workspace and offers a breaking itoa update and a serde floor bump', async () => {
    const root = workspace();
    const { scan } = await prepare(root);
    expect(scan.error).toBeUndefined();
    const by = Object.fromEntries(scan.candidates.map((c) => [c.coordinate.identifier, c]));
    expect(by.itoa).toMatchObject({ currentRange: '0.4', diff: 'major', selected: false, origin: { kind: 'public' } });
    expect(by.itoa!.newRange).toMatch(/^\d+\.\d+$/);
    expect(by.serde).toMatchObject({ currentRange: '1.0.100', diff: 'patch' });
    expect(by.serde!.newRange).toMatch(/^1\.0\.\d+$/);
  }, 120_000);

  it('CUPD-09 updates, refreshes Cargo.lock and passes cargo check --locked', async () => {
    const root = workspace();
    const { module, scan } = await prepare(root);
    const { selected } = selectAll(scan, true);

    const summary = await runUpdateWorkflow(strategy, module, root, selected, {});

    expect(summary.rolledBack).toBeFalsy();
    expect(summary.verificationStatus).toBe('clean');
    const manifest = readFileSync(join(root, 'x/Cargo.toml'), 'utf8');
    expect(manifest).toContain('# keep this comment');
    expect(manifest).not.toContain('serde = "1.0.100"');
    expect(manifest).not.toContain('itoa = "0.4"');
    expect(readFileSync(join(root, 'Cargo.lock'), 'utf8')).not.toContain('version = "0.4.8"');
    cargo(root, 'check', '--locked', '--offline');
  }, 600_000);

  it('CUPD-10 rolls Cargo.toml and Cargo.lock back byte for byte when the new version breaks the build', async () => {
    const root = workspace({ main: 'fn main() { let mut b = Vec::new(); itoa::write(&mut b, 1u32).unwrap(); }\n' });
    const manifest = readFileSync(join(root, 'x/Cargo.toml'));
    const lock = readFileSync(join(root, 'Cargo.lock'));
    const { module, scan } = await prepare(root);

    const summary = await runUpdateWorkflow(strategy, module, root, selectAll(scan, true).selected, {});

    expect(summary.rolledBack).toBe(true);
    expect(summary.verificationDetails).toMatch(/itoa/);
    expect(readFileSync(join(root, 'x/Cargo.toml')).equals(manifest)).toBe(true);
    expect(readFileSync(join(root, 'Cargo.lock')).equals(lock)).toBe(true);
  }, 600_000);

  it('CUPD-14 leaves no Cargo.lock behind in a repository that has none', async () => {
    const root = workspace({ lock: false });
    const { module, scan } = await prepare(root);

    await runUpdateWorkflow(strategy, module, root, selectAll(scan, true).selected, { skipVerification: true });

    expect(readFileSync(join(root, 'x/Cargo.toml'), 'utf8')).not.toContain('serde = "1.0.100"');
    expect(existsSync(join(root, 'Cargo.lock'))).toBe(false);
  }, 120_000);

  it('CCFG-09 a vendored source replacement is refused: the scan fails instead of asking crates.io', async () => {
    const root = workspace({
      lock: false,
      config: '[source.crates-io]\nreplace-with = "vendored"\n[source.vendored]\ndirectory = "vendor"\n',
    });
    const { scan } = await prepare(root);
    expect(scan.candidates).toEqual([]);
    expect(scan.error).toMatch(/cannot read/i);
  }, 120_000);

  describe('with [workspace.dependencies]', () => {
    const ROOT_TOML =
      '# workspace root\n[workspace]\nresolver = "2"\nmembers = ["a", "b"]\n\n[workspace.dependencies]\n' +
      'serde = { version = "1.0.100", features = ["derive"] } # shared\nitoa = "0.4"\n';

    /** `a` and `b` both inherit; `a` needs serde's derive feature that only the root declares. */
    function inheriting(options: { bMain?: string } = {}) {
      const root = makeTree({
        'Cargo.toml': ROOT_TOML,
        'a/Cargo.toml': '[package]\nname = "a"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nserde = { workspace = true }\n',
        'a/src/main.rs': '#[derive(serde::Serialize)]\nstruct P { x: u8 }\nfn main() { let _ = P { x: 1 }; }\n',
        'b/Cargo.toml': '[package]\nname = "b"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nserde.workspace = true\nitoa.workspace = true\n',
        'b/src/main.rs': options.bMain ?? 'fn main() {}\n',
      });
      cargo(root, 'generate-lockfile');
      cargo(root, 'update', '-p', 'itoa', '--precise', '0.4.8');
      return root;
    }

    async function prepareMember(root: string, id: string) {
      const modules = await strategy.discovery.discover(root);
      const module = modules.find((m) => m.id === id)!;
      const context = createScanContext(modules, { rootDir: root, internalScopes: [] }, 'stable');
      return { module, scan: await scanModule(strategy, module, context) };
    }

    it('CDECL-15 an inherited dependency is offered from the workspace root and names the other crate', async () => {
      const root = inheriting();
      const { scan } = await prepareMember(root, 'a');
      expect(scan.error).toBeUndefined();
      const serde = scan.candidates.find((c) => c.coordinate.identifier === 'serde')!;
      expect(serde).toMatchObject({
        currentRange: '1.0.100',
        declaration: { kind: 'dependency-management', displayPath: 'Cargo.toml' },
        sharedWith: ['b'],
      });
    }, 120_000);

    it('CUPD-15 updating an inherited dependency changes only the root, keeps the features and checks the whole workspace', async () => {
      const root = inheriting();
      const memberFiles = ['a/Cargo.toml', 'b/Cargo.toml'].map((f) => readFileSync(join(root, f)));
      const { module, scan } = await prepareMember(root, 'a');
      const serde = scan.candidates.filter((c) => c.coordinate.identifier === 'serde');

      const summary = await runUpdateWorkflow(strategy, module, root, serde.map((c) => ({ ...c, selected: true })), {});

      expect(summary.rolledBack).toBeFalsy();
      expect(summary.verificationStatus).toBe('clean');
      expect(summary.verificationLabel).toContain('--workspace');
      const rootToml = readFileSync(join(root, 'Cargo.toml'), 'utf8');
      expect(rootToml).toContain('# workspace root');
      expect(rootToml).toMatch(/serde = \{ version = "1\.0\.\d+", features = \["derive"\] \} # shared/);
      expect(rootToml).not.toContain('1.0.100');
      expect(rootToml).toContain('itoa = "0.4"');
      expect(['a/Cargo.toml', 'b/Cargo.toml'].map((f) => readFileSync(join(root, f)))).toEqual(memberFiles);
      cargo(root, 'check', '--locked', '--offline');
    }, 600_000);

    it('CUPD-16 a breaking inherited update that breaks another crate restores root, members and lock byte for byte', async () => {
      const root = inheriting({ bMain: 'fn main() { let mut v = Vec::new(); itoa::write(&mut v, 1u32).unwrap(); }\n' });
      const files = ['Cargo.toml', 'a/Cargo.toml', 'b/Cargo.toml', 'Cargo.lock'].map((f) => [f, readFileSync(join(root, f))] as const);
      const { module, scan } = await prepareMember(root, 'a');
      const itoa = await prepareMember(root, 'b').then((r) => ({ module: r.module, update: r.scan.candidates.find((c) => c.coordinate.identifier === 'itoa')! }));
      expect(scan.error).toBeUndefined();
      expect(itoa.update).toMatchObject({ diff: 'major', declaration: { kind: 'dependency-management' } });

      const summary = await runUpdateWorkflow(strategy, itoa.module, root, [{ ...itoa.update, selected: true }], {});

      expect(module).toBeDefined();
      expect(summary.rolledBack).toBe(true);
      expect(summary.verificationDetails).toMatch(/itoa/);
      for (const [file, bytes] of files) expect(readFileSync(join(root, file)).equals(bytes)).toBe(true);
    }, 600_000);
  });

  describe('lock-file-only updates', () => {
    /** `itoa = "1"` allows every 1.x release, while Cargo.lock is held back at 1.0.15. */
    function lockedBehind() {
      const root = makeTree({
        'holds-old-version.js': "process.exit(require('node:fs').readFileSync('Cargo.lock', 'utf8').includes('version = \"1.0.15\"') ? 0 : 1);\n",
        'Cargo.toml': '[workspace]\nresolver = "2"\nmembers = ["x"]\n',
        'x/Cargo.toml': '[package]\nname = "x"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nitoa = "1"\n',
        'x/src/main.rs': 'fn main() {}\n',
      });
      cargo(root, 'generate-lockfile');
      cargo(root, 'update', '-p', 'itoa', '--precise', '1.0.15');
      return root;
    }

    async function prepareLock(root: string) {
      const modules = await strategy.discovery.discover(root);
      const module = modules.find((m) => m.id === 'x')!;
      const context = createScanContext(modules, { rootDir: root, internalScopes: [] }, 'stable');
      return { module, scan: await scanModule(strategy, module, context) };
    }

    it('CLOCK-23 a lock held back behind a loose requirement is offered, updated and verified, with the manifest untouched', async () => {
      const root = lockedBehind();
      const manifest = readFileSync(join(root, 'x/Cargo.toml'));
      const { module, scan } = await prepareLock(root);

      expect(scan.candidates).toHaveLength(1);
      expect(scan.candidates[0]).toMatchObject({ action: 'lock', currentClean: '1.0.15', selected: true, declaration: { kind: 'lockfile' } });
      expect(scan.candidates[0]!.latest).toMatch(/^1\.0\.\d+$/);

      const summary = await runUpdateWorkflow(strategy, module, root, selectAll(scan, false).selected, {});

      expect(summary.rolledBack).toBeFalsy();
      expect(summary.verificationStatus).toBe('clean');
      expect(summary.verificationLabel).toContain('--workspace');
      expect(readFileSync(join(root, 'x/Cargo.toml')).equals(manifest)).toBe(true);
      expect(readFileSync(join(root, 'Cargo.lock'), 'utf8')).not.toContain('version = "1.0.15"');
      cargo(root, 'check', '--locked', '--offline');
    }, 600_000);

    it('CLOCK-24 a failing verification restores Cargo.lock byte for byte', async () => {
      const root = lockedBehind();
      const lockBefore = readFileSync(join(root, 'Cargo.lock'));
      const { module, scan } = await prepareLock(root);

      const summary = await runUpdateWorkflow(strategy, module, root, selectAll(scan, false).selected, {
        // Passes while the old version is locked and fails once the update has moved it, so the
        // failure is the update's and not an existing one.
        postUpdateScript: 'node holds-old-version.js',
        postUpdateLabel: 'old version still locked',
      });

      expect(summary.rolledBack).toBe(true);
      expect(readFileSync(join(root, 'Cargo.lock')).equals(lockBefore)).toBe(true);
    }, 600_000);

    it('CLOCK-25 a repository without Cargo.lock offers no lock updates and gets none', async () => {
      const root = makeTree({
        'Cargo.toml': '[workspace]\nresolver = "2"\nmembers = ["x"]\n',
        'x/Cargo.toml': '[package]\nname = "x"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nitoa = "1"\n',
        'x/src/main.rs': 'fn main() {}\n',
      });
      const { scan } = await prepareLock(root);
      expect(scan.candidates).toEqual([]);
      expect(existsSync(join(root, 'Cargo.lock'))).toBe(false);
    }, 120_000);
  });
});

