/**
 * Elevate — version-control checkout boundary.
 *
 * Searches for markers of the repository (configuration, workspace files,
 * lockfiles) stop at the checkout, so files of unrelated directories above it
 * are never picked up.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * The nearest directory, starting at `startDir` and walking upwards, that
 * contains an entry named `.git` (a directory, or a file in worktrees and
 * submodules). Undefined when there is none.
 */
export function findCheckoutBoundary(startDir: string): string | undefined {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
