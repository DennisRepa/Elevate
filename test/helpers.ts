/**
 * Shared test helpers.
 */

import { cpSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProjectModule, UpdateCandidate } from '../src/domain/models.js';

export const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const created: string[] = [];

/** Copies a fixture into a fresh temporary directory and returns its path. */
export function copyFixture(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `elevate-${name}-`));
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  created.push(dir);
  return dir;
}

/** Creates a temporary directory populated with the given files. */
export function makeTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'elevate-tree-'));
  for (const [path, content] of Object.entries(files)) {
    const file = join(dir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, 'utf8');
  }
  created.push(dir);
  return dir;
}

/** Removes all temporary directories created by this test file. */
export function cleanupTemp(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** A minimal POM document for inline test trees. */
export function pom(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<project xmlns="http://maven.apache.org/POM/4.0.0">\n  <modelVersion>4.0.0</modelVersion>\n${body}\n</project>\n`;
}

/** A discovered npm module for a directory, for tests that bypass discovery. */
export function npmModule(path: string, id = 'root', isRoot = true): ProjectModule {
  return { id, name: id, path, relPath: isRoot ? 'Root' : id, ecosystem: 'npm', isRoot };
}

/** An npm update candidate from one range to another. */
export function npmCandidate(name: string, currentRange: string, newRange: string): UpdateCandidate {
  return {
    coordinate: { identifier: name, artifact: name, ecosystem: 'npm' },
    currentRange,
    currentClean: currentRange.replace(/^\D+/, ''),
    latest: newRange.replace(/^\D+/, ''),
    newRange,
    diff: 'minor',
    scope: 'prod',
    selected: true,
    origin: { kind: 'public' },
    action: 'update',
  };
}
