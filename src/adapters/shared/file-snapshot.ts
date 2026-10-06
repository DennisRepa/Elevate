/**
 * Elevate — file snapshots for rollback.
 *
 * Captures the exact bytes of every file an update may touch, including the
 * fact that a file did not exist yet, so a failed update can be undone
 * completely.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

export class FileSnapshot {
  private constructor(private readonly entries: ReadonlyMap<string, Buffer | null>) {}

  /** Records the current content (or absence) of each file. */
  static capture(files: Iterable<string>): FileSnapshot {
    const entries = new Map<string, Buffer | null>();
    for (const file of files) {
      if (entries.has(file)) continue;
      entries.set(file, existsSync(file) ? readFileSync(file) : null);
    }
    return new FileSnapshot(entries);
  }

  /** The files covered by this snapshot. */
  get files(): string[] {
    return [...this.entries.keys()];
  }

  /** Files whose content differs from the snapshot. */
  changedFiles(): string[] {
    return this.files.filter((file) => {
      const before = this.entries.get(file) ?? null;
      const exists = existsSync(file);
      if (before === null) return exists;
      return !exists || !readFileSync(file).equals(before);
    });
  }

  /** Writes every file back to its captured state; removes files that did not exist. */
  restore(): void {
    for (const [file, content] of this.entries) {
      if (content === null) {
        rmSync(file, { force: true });
      } else {
        writeFileSync(file, content);
      }
    }
  }
}
