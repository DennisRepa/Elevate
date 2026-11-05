/**
 * Elevate — Cargo updater.
 *
 * Writes each new requirement to the literal that declares it — in the
 * member's Cargo.toml or, for `workspace = true`, in the workspace root —
 * splicing only the version text. Then it brings Cargo.lock in line:
 *
 *   1. `cargo update -p name@old`        re-resolves to the newest allowed version
 *   2. `cargo update -p name@new --precise <target>`   only if the chosen version is older
 *
 * Step 2 is needed because `--precise` is ignored while the old lock entry no
 * longer fits the manifest (verified with Cargo 1.97). A repository without a
 * Cargo.lock gets none.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import semver from 'semver';
import { InstallError } from '../../domain/ports.js';
import type { ApplyOutcome, DependencyUpdaterPort } from '../../domain/ports.js';
import type { ProjectModule, UpdateCandidate } from '../../domain/models.js';
import { runCommand, tail } from '../shared/process.js';
import { applyRangeEdits } from '../shared/text-edit.js';
import type { RangeEdit } from '../shared/text-edit.js';
import { StaleEditError } from '../shared/xml.js';
import { readLockedVersions } from './cargo-lockfile.js';
import { satisfiesRequirement } from './cargo-requirement.js';
import { parseCargoManifest } from './cargo-toml.js';

const UPDATE_TIMEOUT_MS = 10 * 60_000;

const workspaceDir = (module: ProjectModule, rootDir: string) => module.aggregatorDir ?? module.path ?? rootDir;

export class CargoUpdaterAdapter implements DependencyUpdaterPort {
  affectedFiles(module: ProjectModule, rootDir: string, updates: UpdateCandidate[]): string[] {
    const files = new Set(updates.map((u) => resolve(u.declaration?.file ?? join(module.path, 'Cargo.toml'))));
    files.add(join(workspaceDir(module, rootDir), 'Cargo.lock'));
    return [...files];
  }

  async applyUpdates(
    module: ProjectModule,
    rootDir: string,
    updates: UpdateCandidate[],
    onProgress: (stepMessage: string) => void,
  ): Promise<ApplyOutcome> {
    const dir = workspaceDir(module, rootDir);
    const lockFile = join(dir, 'Cargo.lock');
    const lockedBefore = readLockedVersions(lockFile);

    // Every edit is computed before the first write, so a stale file leaves nothing half-updated.
    const byFile = new Map<string, UpdateCandidate[]>();
    for (const update of updates) {
      const file = resolve(update.declaration?.file ?? join(module.path, 'Cargo.toml'));
      byFile.set(file, [...(byFile.get(file) ?? []), update]);
    }
    const writes: { file: string; content: string }[] = [];
    for (const [file, fileUpdates] of byFile) {
      onProgress(`Preparing ${fileUpdates.length} change(s) in ${file}…`);
      const source = readFileSync(file, 'utf8');
      const decls = parseCargoManifest(source);
      const edits: RangeEdit[] = [];
      for (const update of fileUpdates) {
        const inWorkspace = update.declaration?.kind === 'dependency-management';
        const name = update.coordinate.identifier;
        const found = decls.filter(
          (d) => d.inWorkspace === inWorkspace && (d.package ?? d.key) === name && d.version?.value === update.currentRange,
        );
        if (found.length === 0) {
          throw new InstallError(`${file}: cannot find the version of ${name} (${update.currentRange}) any more; rescan the module.`);
        }
        for (const d of found) {
          edits.push({ start: d.version!.start, end: d.version!.end, expected: d.version!.value, replacement: update.newRange });
        }
      }
      try {
        writes.push({ file, content: applyRangeEdits(source, edits) });
      } catch (err) {
        if (err instanceof StaleEditError) throw new InstallError(`${file}: ${err.message}`);
        throw err;
      }
    }
    onProgress('Writing Cargo.toml files…');
    for (const write of writes) writeFileSync(write.file, write.content, 'utf8');

    const registryUpdates = updates.filter((u) => u.action === 'update');
    if (existsSync(lockFile) && registryUpdates.length > 0) {
      await this.refreshLock(dir, lockFile, lockedBefore, registryUpdates, onProgress);
    }

    return {
      updatedCount: updates.length,
      auditMessage: `Updated ${updates.length} requirement(s) in ${writes.length} Cargo.toml file(s)${existsSync(lockFile) ? '; Cargo.lock refreshed' : ''}.`,
      auditSeverity: 'clean',
      integrityViolations: [],
    };
  }

  async resync(): Promise<void> {
    // Cargo keeps no installed state next to the manifests; restoring them and Cargo.lock suffices.
  }

  private async refreshLock(
    dir: string,
    lockFile: string,
    before: Map<string, string[]>,
    updates: UpdateCandidate[],
    onProgress: (stepMessage: string) => void,
  ): Promise<void> {
    const specs: string[] = [];
    for (const update of updates) {
      const name = update.coordinate.identifier;
      const versions = before.get(name) ?? [];
      // The entry the old requirement resolved to; a crate locked twice is told apart by that.
      const old = versions.find((v) => satisfiesRequirement(update.currentRange, v)) ?? versions[0];
      if (old) specs.push(`${name}@${old}`);
    }
    if (specs.length === 0) return;

    onProgress('Updating Cargo.lock…');
    await this.cargoUpdate(dir, specs.flatMap((s) => ['-p', s]));

    const after = readLockedVersions(lockFile);
    for (const update of updates) {
      const name = update.coordinate.identifier;
      const locked = (after.get(name) ?? []).find((v) => satisfiesRequirement(update.newRange, v));
      if (locked && semver.valid(update.latest) && locked !== update.latest) {
        onProgress(`Pinning ${name} to ${update.latest}…`);
        await this.cargoUpdate(dir, ['-p', `${name}@${locked}`, '--precise', update.latest]);
      }
    }
  }

  private async cargoUpdate(dir: string, args: string[]): Promise<void> {
    const result = await runCommand('cargo', ['update', ...args], { cwd: dir, timeoutMs: UPDATE_TIMEOUT_MS });
    if (result.exitCode !== 0) {
      const reason = result.timedOut ? 'cargo update timed out' : 'cargo update failed';
      throw new InstallError(reason, tail(result.stderr || result.stdout));
    }
  }
}
