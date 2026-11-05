/**
 * Elevate — Cargo verification.
 *
 * `cargo check --all-targets` type-checks libraries, binaries, tests, benches
 * and examples without generating code — the counterpart of `mvn test-compile`.
 * It covers the members whose manifests changed plus every member that depends
 * on them by path, because a change in a library breaks its consumers. A
 * changed workspace root manifest (shared `[workspace.dependencies]`) checks
 * the whole workspace, and so does a change to Cargo.lock alone (a lock-only
 * update reaches every crate that uses the dependency).
 *
 * Doctests, non-default features and other targets are not covered; a
 * `postUpdateScript` is the way to add them.
 */

import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { VerificationOptions, VerificationPort, VerificationResult } from '../../domain/ports.js';
import type { ProjectModule } from '../../domain/models.js';
import { runShellScript, tail } from '../shared/process.js';
import { cargoErrors, runCargo } from './cargo-command.js';
import { loadMetadata } from './cargo-metadata.js';
import type { CargoMetadata } from './cargo-metadata.js';

const VERIFY_TIMEOUT_MS = 30 * 60_000;

const same = (a: string, b: string) => relative(resolve(a), resolve(b)) === '';

/** The arguments of the `cargo check` that covers the change. */
export function planCheck(metadata: CargoMetadata, module: ProjectModule, changedFiles: readonly string[], locked: boolean): string[] {
  const args = ['check', '--all-targets', ...(locked ? ['--locked'] : [])];
  const rootManifest = join(metadata.workspace_root, 'Cargo.toml');
  const lockFile = join(metadata.workspace_root, 'Cargo.lock');
  const memberManifests = new Set(metadata.packages.map((p) => resolve(p.manifest_path)));

  if (changedFiles.some((f) => same(f, rootManifest))) {
    // A root manifest that is itself a member only matters when it holds workspace-wide settings.
    const isVirtualRoot = !memberManifests.has(resolve(rootManifest));
    if (isVirtualRoot || metadata.packages.length > 1) return [...args, '--workspace'];
  }

  // A new version in Cargo.lock reaches every crate that uses the dependency, and no manifest says which.
  if (changedFiles.length > 0 && changedFiles.every((f) => same(f, lockFile))) return [...args, '--workspace'];

  const changed = new Set(
    metadata.packages.filter((p) => changedFiles.some((f) => same(f, p.manifest_path))).map((p) => p.name),
  );
  if (changed.size === 0) changed.add(module.id);

  // Everything that reaches a changed member through path dependencies.
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of metadata.packages) {
      if (changed.has(p.name)) continue;
      if (p.dependencies.some((d) => d.source === null && d.path && changed.has(d.name))) {
        changed.add(p.name);
        grew = true;
      }
    }
  }
  const ordered = metadata.packages.filter((p) => changed.has(p.name)).map((p) => p.name);
  return [...args, ...ordered.flatMap((name) => ['-p', name])];
}

export interface CargoVerifierDeps {
  loadMetadata(dir: string): Promise<CargoMetadata>;
  hasLock(dir: string): boolean;
}

export class CargoVerificationAdapter implements VerificationPort {
  constructor(
    private readonly deps: CargoVerifierDeps = { loadMetadata, hasLock: (dir) => existsSync(join(dir, 'Cargo.lock')) },
  ) {}

  async verify(module: ProjectModule, rootDir: string, options: VerificationOptions = {}): Promise<VerificationResult> {
    const dir = module.aggregatorDir ?? module.path ?? rootDir;

    if (options.customScript) {
      const label = options.customLabel || options.customScript;
      const result = await runShellScript(options.customScript, { cwd: dir, timeoutMs: VERIFY_TIMEOUT_MS });
      return result.exitCode === 0
        ? { status: 'clean', details: 'Verification script succeeded.', label }
        : { status: 'warn', details: tail(result.stderr || result.stdout), label };
    }

    const metadata = await this.deps.loadMetadata(dir);
    const args = planCheck(metadata, module, options.changedFiles ?? [], this.deps.hasLock(dir));
    const label = `Cargo build (cargo ${args.join(' ')})`;
    const result = await runCargo(args, { cwd: dir, timeoutMs: VERIFY_TIMEOUT_MS });
    if (result.exitCode === 0) return { status: 'clean', details: 'All affected crates type-check, including tests.', label };
    return {
      status: 'warn',
      details: result.timedOut ? 'cargo check timed out.' : cargoErrors(`${result.stderr}\n${result.stdout}`),
      label,
    };
  }
}
