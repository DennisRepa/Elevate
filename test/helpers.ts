/**
 * Shared test helpers.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
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

/** The `maven-metadata.xml` of a module: the versions a repository lists. */
export function mavenMetadata(group: string, name: string, versions: readonly string[]): string {
  const list = versions.map((v) => `<version>${v}</version>`).join('');
  return `<metadata><groupId>${group}</groupId><artifactId>${name}</artifactId><versioning><versions>${list}</versions></versioning></metadata>`;
}

/**
 * Writes a Maven-layout file repository that lists the given versions of
 * modules (`group:name` → versions). Only the listing is written: a lookup of
 * versions asks for nothing else.
 */
export function writeVersionRepository(dir: string, modules: Record<string, readonly string[]>): void {
  for (const [coordinate, versions] of Object.entries(modules)) {
    const [group, name] = coordinate.split(':') as [string, string];
    const folder = join(dir, ...group.split('.'), name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'maven-metadata.xml'), mavenMetadata(group, name, versions));
  }
}

/** A module for `writeJarRepository`: its versions, each with the Java sources of its classes (path → source). */
export interface JarModule {
  group: string;
  name: string;
  versions: Record<string, Record<string, string>>;
}

/**
 * Writes a Maven-layout file repository whose modules hold real jars. The tiny
 * classes are compiled with the JDK (`javac`, `jar`), so a build that compiles
 * against a version really sees its API. Each version gets its pom, and the
 * module its `maven-metadata.xml` listing all versions.
 */
export function writeJarRepository(dir: string, modules: readonly JarModule[]): void {
  for (const module of modules) {
    const folder = join(dir, ...module.group.split('.'), module.name);
    mkdirSync(folder, { recursive: true });
    for (const [version, sources] of Object.entries(module.versions)) {
      const work = mkdtempSync(join(tmpdir(), 'elevate-jar-'));
      try {
        const files = Object.entries(sources).map(([path, source]) => {
          const file = join(work, 'src', path);
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, source);
          return file;
        });
        mkdirSync(join(work, 'classes'), { recursive: true });
        execFileSync('javac', ['-d', join(work, 'classes'), ...files], { stdio: 'pipe' });
        mkdirSync(join(folder, version), { recursive: true });
        execFileSync('jar', ['cf', join(folder, version, `${module.name}-${version}.jar`), '-C', join(work, 'classes'), '.'], {
          stdio: 'pipe',
        });
        writeFileSync(
          join(folder, version, `${module.name}-${version}.pom`),
          `<project><modelVersion>4.0.0</modelVersion><groupId>${module.group}</groupId><artifactId>${module.name}</artifactId><version>${version}</version></project>`,
        );
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    }
    writeFileSync(join(folder, 'maven-metadata.xml'), mavenMetadata(module.group, module.name, Object.keys(module.versions)));
  }
}

/** Runs `gradle` on the PATH in a directory and returns its exit code (for building the state of a fixture). */
export function runGradleIn(cwd: string, ...args: string[]): { status: number | null; output: string } {
  try {
    const output = execFileSync('gradle', ['-q', '--console=plain', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });
    return { status: 0, output };
  } catch (err) {
    const failure = err as { status: number | null; stdout?: string; stderr?: string };
    return { status: failure.status, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

/** Reads a file of a tree. */
export function readTreeFile(root: string, file: string): string {
  return existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8') : '';
}
