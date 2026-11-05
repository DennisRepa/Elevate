/**
 * Elevate — Gradle module discovery.
 *
 * Finds the Gradle builds of a repository by walking the tree (no process),
 * asks Gradle to describe each build that no outer build includes, and turns
 * the descriptions into modules. A build file is a program, so the projects
 * are Gradle's answer, not a parse of the files (specs/22).
 */

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type { ModuleDiscoveryPort } from '../../domain/ports.js';
import type { ProjectModule } from '../../domain/models.js';
import { runDescribe } from './gradle-probe.js';
import type { GradleBuildDocument, GradleProjectDocument } from './gradle-probe.js';

const SETTINGS_FILES = ['settings.gradle', 'settings.gradle.kts'];
const BUILD_FILES = ['build.gradle', 'build.gradle.kts'];
const MAX_DEPTH = 6;
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'target', 'build', 'dist', 'out', 'buildSrc']);

function hasSettings(dir: string): boolean {
  return SETTINGS_FILES.some((file) => existsSync(join(dir, file)));
}

function hasBuildScript(dir: string): boolean {
  return BUILD_FILES.some((file) => existsSync(join(dir, file)));
}

function subdirectories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * The directories of the Gradle builds below `rootDir`, found without running
 * Gradle: a directory with a settings file, or with a build script when
 * neither it nor an ancestor up to the root has a settings file. Absolute and
 * sorted (an outer build comes before the builds below it).
 */
export function findGradleBuildDirs(rootDir: string): string[] {
  const root = resolve(rootDir);
  const found: string[] = [];

  const walk = (dir: string, depth: number, settingsAbove: boolean): void => {
    const settings = hasSettings(dir);
    const script = hasBuildScript(dir);
    if (settings || (script && !settingsAbove)) found.push(dir);
    if (depth >= MAX_DEPTH) return;

    const inScope = settingsAbove || settings;
    for (const name of subdirectories(dir)) {
      if (name.startsWith('.') || SKIPPED_DIRECTORIES.has(name)) continue;
      // The source tree of a project holds fixtures and sample builds.
      if (name === 'src' && (settings || script)) continue;
      walk(join(dir, name), depth + 1, inScope);
    }
  };

  walk(root, 0, false);
  return found.sort();
}

// ---- repository root ---------------------------------------------------------

/** Removes block and line comments from a settings file. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Whether the settings file of `settingsDir` includes `target` with `includeBuild` and a string literal. */
function includesBuild(settingsDir: string, target: string): boolean {
  for (const file of SETTINGS_FILES) {
    let text: string;
    try {
      text = stripComments(readFileSync(join(settingsDir, file), 'utf8'));
    } catch {
      continue;
    }
    for (const match of text.matchAll(/includeBuild\s*\(?\s*(['"])(.*?)\1/g)) {
      if (resolve(settingsDir, match[2]!) === target) return true;
    }
  }
  return false;
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

export class GradleModuleDiscoveryAdapter implements ModuleDiscoveryPort {
  /**
   * Proposes the root of the Gradle build around `startDir`: the nearest
   * settings file (else the start directory's own build script), `buildSrc`
   * belonging to the build around it, and builds climbing to the outermost
   * build that includes them with a literal `includeBuild`. Reads settings
   * files as text and starts no process.
   */
  findRoot(startDir: string, boundaryDir: string | undefined): string | undefined {
    const start = resolve(startDir);
    const boundary = boundaryDir ? resolve(boundaryDir) : undefined;

    let dir: string | undefined;
    if (hasSettings(start)) {
      dir = start;
    } else {
      dir = ancestorsWithin(start, boundary).find((ancestor) => hasSettings(ancestor));
    }
    if (!dir) {
      if (!hasBuildScript(start)) return undefined;
      dir = start;
    }

    if (basename(dir) === 'buildSrc') {
      const parent = ancestorsWithin(dir, boundary)[0];
      if (parent && hasSettings(parent)) dir = parent;
    }

    for (;;) {
      const current = dir;
      const includer = ancestorsWithin(current, boundary).find(
        (ancestor) => hasSettings(ancestor) && includesBuild(ancestor, current),
      );
      if (!includer) return current;
      dir = includer;
    }
  }

  async discover(rootDir: string): Promise<ProjectModule[]> {
    const root = resolve(rootDir);
    const buildDirs = findGradleBuildDirs(root);
    if (buildDirs.length === 0) return [];

    // An outer build comes first; a build it includes is described by it.
    const described = new Set<string>();
    const builds: { document: GradleBuildDocument; runDir: string }[] = [];
    for (const runDir of buildDirs) {
      if (described.has(canonical(runDir))) continue;
      for (const document of await runDescribe(runDir, root)) {
        described.add(canonical(document.build.dir));
        builds.push({ document, runDir });
      }
    }

    const modules: ProjectModule[] = [];
    const taken = new Set<string>();
    for (const { document, runDir } of builds) {
      if (isOutside(root, document.build.dir)) continue;
      const primary = canonical(document.build.dir) === canonical(root) && document.build.kind === 'root';

      for (const project of document.projects) {
        const isBuildRoot = project.path === ':';
        if (!isBuildRoot && !project.buildFile) continue;
        if (isOutside(root, project.dir)) continue;
        const module = toModule(document, project, runDir, root, primary);
        if (taken.has(module.id)) module.id = `${module.id}@${module.relPath}`;
        taken.add(module.id);
        modules.push(module);
      }
    }

    modules.sort((a, b) => (a.isRoot ? -1 : b.isRoot ? 1 : a.relPath.localeCompare(b.relPath)));
    return modules;
  }
}

function canonical(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return resolve(dir);
  }
}

function isOutside(root: string, dir: string): boolean {
  const path = relative(canonical(root), canonical(dir));
  return path.startsWith('..') || resolve(path) === path;
}

/**
 * The id of a project: its Gradle path in the primary build, and the name of
 * the build first in every other build (an included build, buildSrc, an
 * independent build in a subdirectory): `:build-logic`, `:buildSrc`, `:demo`.
 */
export function gradleModuleId(
  build: GradleBuildDocument['build'],
  project: Pick<GradleProjectDocument, 'path'>,
  primary: boolean,
): string {
  return primary ? project.path : `:${build.name}${project.path === ':' ? '' : project.path}`;
}

function toModule(
  document: GradleBuildDocument,
  project: GradleProjectDocument,
  runDir: string,
  root: string,
  primary: boolean,
): ProjectModule {
  const build = document.build;
  const isBuildRoot = project.path === ':';
  const relPath = relative(canonical(root), canonical(project.dir)).replace(/\\/g, '/');
  const id = gradleModuleId(build, project, primary);
  const version = project.version && project.version !== 'unspecified' ? project.version : undefined;
  const name = isBuildRoot ? build.name : project.name;

  return {
    id,
    name,
    path: project.dir,
    relPath: relPath || 'Root',
    ecosystem: 'gradle',
    isRoot: isBuildRoot && primary,
    version,
    buildDir: runDir,
    buildRoot: build.dir,
    buildKind: build.kind,
    coordinates: project.group ? `${project.group}:${project.name}` : undefined,
  };
}
