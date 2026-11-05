/**
 * Elevate — Gradle dependency locks.
 *
 * With dependency locking (`dependencyLocking { lockAllConfigurations() }`) a
 * `gradle.lockfile` sits in each project directory, and raising a declared
 * version makes every task that resolves it fail until the lock is refreshed
 * ("Dependency version enforced by Dependency Locking"). Elevate refreshes the
 * locks with Gradle's own command (specs/25, facts 22, 34 to 36):
 *
 *     <gradle> -q --console=plain --no-configuration-cache
 *         :app:dependencies :core:dependencies … --update-locks g:a,g:b
 *
 * The task `dependencies` must be named per project (at the root it reports
 * the root project only), and all lock files of the build are refreshed
 * together, because a stale lock does not always fail: a lower declared
 * version is silently resolved down to the locked one.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ProjectModule } from '../../domain/models.js';
import { InstallError } from '../../domain/ports.js';
import { UnsafeArgumentError } from '../shared/process.js';
import { GradleCommandError, GradleUnavailableError, GradleVersionError, gradleErrors, runGradle } from './gradle-command.js';
import { runDescribe } from './gradle-probe.js';

const LOCK_FILE = 'gradle.lockfile';
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'build', 'target', 'dist', 'out']);
const REFRESH_TIMEOUT_MINUTES = 10;

/**
 * Every `gradle.lockfile` below the directory of a build, absolute and sorted.
 * Build output and dependency directories, and directories whose name starts
 * with ".", are not entered.
 */
export function findLockFiles(buildDir: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name === LOCK_FILE) found.push(join(dir, entry.name));
      else if (entry.isDirectory() && !entry.name.startsWith('.') && !SKIPPED_DIRECTORIES.has(entry.name)) {
        walk(join(dir, entry.name));
      }
    }
  };
  walk(resolve(buildDir));
  return found.sort();
}

/**
 * Brings the lock files of the module's build up to date for the updated
 * coordinates (`group:name`). Describes the build, names `:dependencies` for
 * each project that has a lock file in the order of their Gradle paths, and
 * returns the number of lock files that exist afterwards.
 *
 * @throws InstallError when Gradle cannot be run, fails, or does not finish
 */
export async function refreshLocks(module: ProjectModule, rootDir: string, coordinates: readonly string[]): Promise<number> {
  const buildDir = module.buildDir ?? module.path;
  try {
    const documents = await runDescribe(buildDir, rootDir);
    const build = documents.find((doc) => resolve(doc.build.dir) === resolve(buildDir)) ?? documents[0];
    const locked = (build?.projects ?? []).filter((project) => project.lockfile).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    if (locked.length === 0) return 0;

    const tasks = locked.map((project) => `${project.path === ':' ? '' : project.path}:dependencies`);
    const args = [
      '-q',
      '--console=plain',
      '--no-configuration-cache',
      ...tasks,
      '--update-locks',
      [...new Set(coordinates)].sort().join(','),
    ];
    const result = await runGradle(args, { cwd: buildDir, rootDir, timeoutMs: REFRESH_TIMEOUT_MINUTES * 60_000 });
    if (result.timedOut) {
      throw new InstallError(`Refreshing the Gradle dependency locks timed out after ${REFRESH_TIMEOUT_MINUTES} minutes.`);
    }
    if (result.exitCode !== 0) {
      throw new InstallError(`Refreshing the Gradle dependency locks failed\n${gradleErrors(result)}`);
    }
    return locked.filter((project) => existsSync(join(project.dir, LOCK_FILE))).length;
  } catch (err) {
    if (err instanceof InstallError) throw err;
    if (
      err instanceof UnsafeArgumentError ||
      err instanceof GradleUnavailableError ||
      err instanceof GradleCommandError ||
      err instanceof GradleVersionError
    ) {
      throw new InstallError(err.message);
    }
    throw err;
  }
}
