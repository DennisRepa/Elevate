/**
 * Elevate — the set of POM files in a repository.
 *
 * Indexes every pom.xml below the repository root (including the root POM),
 * resolves parent chains between them and determines which aggregator's
 * reactor builds each project.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { interpolate, parentPomFile, readPom } from './maven-pom.js';
import type { PomModel, PomParent } from './maven-pom.js';

const MAX_DEPTH = 6;
const SKIPPED_DIRS = new Set(['node_modules', 'target', 'build', 'dist', 'out']);

export interface PomCoordinates {
  groupId: string;
  artifactId: string;
  version?: string;
}

export interface PomChain {
  /** The project first, followed by its parents that live in this repository. */
  poms: PomModel[];
  /** The first parent that is not part of this repository, if any. */
  externalParent?: PomParent;
}

export class MavenProject {
  private readonly byFile = new Map<string, PomModel>();
  private readonly aggregators = new Map<string, string>();

  private constructor(
    readonly rootDir: string,
    readonly poms: PomModel[],
  ) {
    for (const pom of poms) this.byFile.set(pom.file, pom);
    this.assignAggregators();
  }

  /**
   * Loads every readable pom.xml below `rootDir`, plus every module listed in
   * a `<modules>` section, even in directories the file walk skips (such as
   * `build/` or `dist/`). Malformed files are skipped.
   */
  static load(rootDir: string): MavenProject {
    const poms: PomModel[] = [];
    const queue = findPomFiles(rootDir);
    const seen = new Set(queue);
    while (queue.length > 0) {
      const file = queue.shift()!;
      let pom: PomModel;
      try {
        pom = readPom(file);
      } catch {
        // A malformed or missing POM cannot be built by Maven either; it is not a module.
        continue;
      }
      poms.push(pom);
      for (const entry of pom.modules) {
        const target = resolve(pom.dir, entry);
        const moduleFile = target.endsWith('.xml') ? target : join(target, 'pom.xml');
        if (!seen.has(moduleFile) && existsSync(moduleFile)) {
          seen.add(moduleFile);
          queue.push(moduleFile);
        }
      }
    }
    return new MavenProject(rootDir, poms);
  }

  pomAt(file: string): PomModel | undefined {
    return this.byFile.get(resolve(file));
  }

  /** The project followed by its local parents, stopping at the first external parent. */
  chainOf(pom: PomModel): PomChain {
    const poms: PomModel[] = [pom];
    let current = pom;
    while (current.parent) {
      const parent = this.localParentOf(current);
      if (!parent || poms.includes(parent)) {
        return { poms, externalParent: parent ? undefined : current.parent };
      }
      poms.push(parent);
      current = parent;
    }
    return { poms };
  }

  /** Coordinates of a project with inherited groupId/version and interpolated values. */
  coordinatesOf(pom: PomModel): PomCoordinates {
    const chain = this.chainOf(pom).poms;
    const groupId = pom.groupId ?? pom.parent?.groupId ?? '';
    const rawVersion = pom.version ?? pom.parent?.version;
    const version = rawVersion ? interpolate(rawVersion, chain) : undefined;
    return {
      groupId: interpolate(groupId, chain),
      artifactId: pom.artifactId,
      version: version && !version.includes('${') ? version : undefined,
    };
  }

  /** Directory of the outermost aggregator whose reactor includes this project. */
  aggregatorDirOf(pom: PomModel): string | undefined {
    return this.aggregators.get(pom.file);
  }

  private localParentOf(pom: PomModel): PomModel | undefined {
    const parent = pom.parent;
    if (!parent) return undefined;

    // Compares against the candidate's own declarations only, interpolated with
    // its own properties. Resolving the candidate's full chain here would
    // recurse endlessly on (invalid) cyclic parent declarations.
    const matches = (candidate: PomModel | undefined) => {
      if (!candidate) return false;
      const groupId = interpolate(candidate.groupId ?? candidate.parent?.groupId ?? '', [candidate]);
      const version = interpolate(candidate.version ?? candidate.parent?.version ?? '', [candidate]);
      const expected = interpolate(parent.version, [pom]);
      return (
        groupId === parent.groupId &&
        candidate.artifactId === parent.artifactId &&
        (version.includes('${') || expected.includes('${') || version === expected)
      );
    };

    // Maven uses the POM at <relativePath> (default ../pom.xml) when its
    // coordinates match; otherwise the parent comes from a repository.
    const file = parentPomFile(pom);
    const byPath = file ? this.byFile.get(resolve(file)) : undefined;
    return matches(byPath) ? byPath : undefined;
  }

  /**
   * Walks `<modules>` from every aggregator, outermost first, and records for
   * each reached project the aggregator that builds it.
   */
  private assignAggregators(): void {
    const aggregatorPoms = this.poms
      .filter((pom) => pom.modules.length > 0)
      .sort((a, b) => a.dir.length - b.dir.length);

    for (const aggregator of aggregatorPoms) {
      if (this.aggregators.has(aggregator.file)) continue;
      const queue: PomModel[] = [aggregator];
      while (queue.length > 0) {
        const pom = queue.shift()!;
        if (this.aggregators.has(pom.file)) continue;
        this.aggregators.set(pom.file, aggregator.dir);
        for (const entry of pom.modules) {
          const target = resolve(pom.dir, entry);
          const file = target.endsWith('.xml') ? target : join(target, 'pom.xml');
          const modulePom = this.byFile.get(file);
          if (modulePom) queue.push(modulePom);
        }
      }
    }
  }
}

/**
 * Finds pom.xml files: the root POM and every POM in subdirectories, except
 * below build output, dependency directories and the `src` of a project.
 */
function findPomFiles(rootDir: string): string[] {
  const results: string[] = [];
  const rootPom = join(rootDir, 'pom.xml');
  if (existsSync(rootPom)) results.push(resolve(rootPom));

  const walk = (dir: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const isProject = existsSync(join(dir, 'pom.xml'));
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue;
      // Maven reserves `<project>/src` for sources, resources and test
      // projects (fixtures, invoker ITs, archetype templates), not modules.
      if (isProject && entry.name === 'src') continue;
      const subDir = join(dir, entry.name);
      const pom = join(subDir, 'pom.xml');
      if (existsSync(pom) && statSync(pom).isFile()) results.push(resolve(pom));
      walk(subDir, depth + 1);
    }
  };

  walk(rootDir, 1);
  return results;
}
