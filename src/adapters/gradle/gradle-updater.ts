/**
 * Elevate — Gradle updater.
 *
 * Writes each new version to the text that declares it (specs/23) and brings
 * the dependency locks of the build up to date when it uses them (specs/25).
 * Edits replace only the version text, so layout, quotes, comments, line
 * endings and a byte order mark survive, and each edit checks that the file
 * still holds what the scan saw. Every edit is computed before the first file
 * is written.
 *
 * Gradle has no installed state to repair: the snapshot of the files taken by
 * the update workflow is the whole rollback, and the verification that follows
 * (a Gradle run that resolves and compiles) is what judges the result.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { ProjectModule, UpdateCandidate, VersionDeclaration } from '../../domain/models.js';
import { InstallError } from '../../domain/ports.js';
import type { ApplyOutcome, DependencyUpdaterPort } from '../../domain/ports.js';
import { StaleEditError } from '../shared/xml.js';
import { findLockFiles, refreshLocks } from './gradle-locks.js';
import { applyGradleEdits } from './gradle-text.js';
import type { GradleTextEdit } from './gradle-text.js';

/** The places a candidate's version is written, the first being its main declaration. */
function declarationsOf(update: UpdateCandidate): VersionDeclaration[] {
  return update.declarations ?? (update.declaration ? [update.declaration] : []);
}

function display(rootDir: string, file: string): string {
  return relative(rootDir, file).replace(/\\/g, '/');
}

function describeShared(declaration: VersionDeclaration): string {
  if (declaration.kind === 'property') return `the property $${declaration.propertyName} in ${declaration.displayPath}`;
  if (declaration.kind === 'catalog') return `the version ${declaration.entry} in ${declaration.displayPath}`;
  return `a version in ${declaration.displayPath}`;
}

export class GradleUpdaterAdapter implements DependencyUpdaterPort {
  /**
   * The files named by the declarations, in the order of the candidates, then
   * every lock file below the directory of the build. `verification-metadata.xml`
   * is never among them: it is not regenerated (a regenerated file records the
   * checksum of whatever was downloaded and defeats its purpose).
   */
  affectedFiles(module: ProjectModule, _rootDir: string, updates: UpdateCandidate[]): string[] {
    const files = new Set<string>();
    for (const update of updates) {
      for (const declaration of declarationsOf(update)) files.add(resolve(declaration.file));
    }
    for (const lock of findLockFiles(module.buildDir ?? module.path)) files.add(lock);
    return [...files];
  }

  async applyUpdates(
    module: ProjectModule,
    rootDir: string,
    updates: UpdateCandidate[],
    onProgress: (stepMessage: string) => void,
  ): Promise<ApplyOutcome> {
    const buildDir = module.buildDir ?? module.path;
    const inRootBuild = module.buildKind === undefined || module.buildKind === 'root';

    // Locks of an included build or buildSrc are not refreshed; a half-refreshed lock state
    // is worse than none, so such an update is refused before anything changes.
    if (!inRootBuild) {
      const locks = findLockFiles(module.buildRoot ?? module.path);
      if (locks.length > 0) {
        throw new InstallError(
          `The build of module ${module.id} (${module.relPath}) uses dependency locking (${display(rootDir, locks[0]!)}), ` +
            'which Elevate refreshes only for the root build. Nothing was changed.',
        );
      }
    }

    // Compute every edit before writing anything, so a stale or conflicting edit
    // in the second file does not leave the first one half-updated.
    const byFile = new Map<string, { displayPath: string; edits: Map<string, GradleTextEdit & { identifier: string; declaration: VersionDeclaration }> }>();
    for (const update of updates) {
      const identifier = update.coordinate.identifier;
      const declarations = declarationsOf(update);
      if (declarations.length === 0) {
        throw new InstallError(`No version declaration known for ${identifier}; rescan the module.`);
      }
      for (const declaration of declarations) {
        if (!declaration.range) {
          throw new InstallError(`${declaration.displayPath}: cannot find the version of ${identifier} any more; rescan the module.`);
        }
        const file = resolve(declaration.file);
        const entry = byFile.get(file) ?? { displayPath: declaration.displayPath, edits: new Map() };
        byFile.set(file, entry);

        const key = `${declaration.range.start}:${declaration.range.end}`;
        const existing = entry.edits.get(key);
        if (existing) {
          if (existing.replacement !== update.newRange) {
            throw new InstallError(
              `${identifier} and ${existing.identifier} share ${describeShared(declaration)} ` +
                `but target different versions (${update.newRange} vs ${existing.replacement}).`,
            );
          }
          continue;
        }
        entry.edits.set(key, {
          start: declaration.range.start,
          end: declaration.range.end,
          expected: declaration.range.text ?? update.currentRange,
          replacement: update.newRange,
          before: declaration.range.before,
          after: declaration.range.after,
          identifier,
          declaration,
        });
      }
    }

    const writes: { file: string; content: string }[] = [];
    for (const [file, { displayPath, edits }] of byFile) {
      onProgress(`Preparing ${edits.size} change(s) in ${displayPath}…`);
      try {
        writes.push({ file, content: applyGradleEdits(readFileSync(file, 'utf8'), [...edits.values()]) });
      } catch (err) {
        if (err instanceof StaleEditError) throw new InstallError(`${displayPath}: ${err.message}`);
        throw err;
      }
    }

    onProgress('Writing build files…');
    for (const write of writes) writeFileSync(write.file, write.content, 'utf8');

    // A library or platform was updated and the build locks its dependencies: refresh the locks.
    let refreshed = 0;
    const libraries = updates.filter((update) => update.scope !== 'plugin');
    if (inRootBuild && libraries.length > 0 && findLockFiles(buildDir).length > 0) {
      onProgress('Refreshing dependency locks…');
      refreshed = await refreshLocks(module, rootDir, libraries.map((update) => update.coordinate.identifier));
    }

    return {
      updatedCount: updates.length,
      auditMessage:
        `Updated ${updates.length} version declaration(s) in ${writes.length} file(s).` +
        (refreshed > 0 ? ` Refreshed ${refreshed} dependency lock file(s).` : ''),
      auditSeverity: 'clean',
      integrityViolations: [],
    };
  }

  async resync(): Promise<void> {
    // Gradle keeps no installed state next to the build files; restoring them suffices.
  }
}
