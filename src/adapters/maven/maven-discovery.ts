/**
 * Elevate — Maven module discovery.
 *
 * Reports every Maven project in the repository, including the root POM,
 * with its coordinates, its version (inherited and interpolated where
 * possible) and the aggregator whose reactor builds it.
 */

import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { ModuleDiscoveryPort } from '../../domain/ports.js';
import type { ProjectModule } from '../../domain/models.js';
import { MavenProject } from './maven-project.js';
import { interpolate, parentPomFile, readPom } from './maven-pom.js';
import type { PomModel } from './maven-pom.js';

export class MavenModuleDiscoveryAdapter implements ModuleDiscoveryPort {
  /**
   * Proposes a root only when `startDir` holds a pom.xml, and then climbs to
   * the POM above until there is none: the top of the connected POM chain.
   */
  findRoot(startDir: string, boundaryDir: string | undefined): string | undefined {
    let dir = resolve(startDir);
    if (!existsSync(join(dir, 'pom.xml'))) return undefined;
    const boundary = boundaryDir ? resolve(boundaryDir) : undefined;
    for (;;) {
      const above = pomAbove(dir, boundary);
      if (!above) return dir;
      dir = above;
    }
  }

  async discover(rootDir: string): Promise<ProjectModule[]> {
    const project = MavenProject.load(rootDir);

    const modules = project.poms.map((pom): ProjectModule => {
      const coordinates = project.coordinatesOf(pom);
      const relPath = relative(rootDir, pom.dir).replace(/\\/g, '/');
      return {
        id: coordinates.groupId ? `${coordinates.groupId}:${coordinates.artifactId}` : coordinates.artifactId,
        name: pom.name ? interpolate(pom.name, project.chainOf(pom).poms) : pom.artifactId,
        path: pom.dir,
        relPath: relPath || 'Root',
        ecosystem: 'maven',
        isRoot: relPath === '',
        version: coordinates.version,
        aggregatorDir: project.aggregatorDirOf(pom),
      };
    });

    modules.sort((a, b) => (a.isRoot ? -1 : b.isRoot ? 1 : a.relPath.localeCompare(b.relPath)));
    return modules;
  }
}

/** Reads a POM, treating a missing or malformed file as absent. */
function tryReadPom(file: string): PomModel | undefined {
  try {
    return readPom(file);
  } catch {
    return undefined;
  }
}

/** Strict ancestors of `dir`, nearest first, up to and including the boundary. */
function ancestorsWithin(dir: string, boundary: string | undefined): string[] {
  const result: string[] = [];
  let current = dir;
  while (current !== boundary) {
    const parent = dirname(current);
    if (parent === current) break;
    result.push(parent);
    current = parent;
  }
  return result;
}

/**
 * The directory of the POM above the project in `dir`: the outermost of its
 * local parent and the nearest aggregator that lists it as a module.
 */
function pomAbove(dir: string, boundary: string | undefined): string | undefined {
  const pom = tryReadPom(join(dir, 'pom.xml'));
  if (!pom) return undefined;
  const ancestors = ancestorsWithin(dir, boundary);
  const found: string[] = [];

  const parentFile = parentPomFile(pom);
  if (parentFile && pom.parent && ancestors.includes(dirname(parentFile))) {
    const parent = tryReadPom(parentFile);
    const groupId = parent?.groupId ?? parent?.parent?.groupId;
    if (parent && parent.artifactId === pom.parent.artifactId && groupId === pom.parent.groupId) {
      found.push(dirname(parentFile));
    }
  }

  const ownFile = join(dir, 'pom.xml');
  const aggregator = ancestors.find((ancestor) =>
    tryReadPom(join(ancestor, 'pom.xml'))?.modules.some((entry) => {
      const target = resolve(ancestor, entry);
      return target === dir || target === ownFile;
    }),
  );
  if (aggregator) found.push(aggregator);

  // The outermost has the shortest path: all candidates are ancestors of `dir`.
  return found.sort((a, b) => a.length - b.length)[0];
}
