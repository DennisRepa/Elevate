/**
 * Elevate — the Gradle probe: asks Gradle instead of parsing build files.
 *
 * Two runs of the build's own Gradle with a small init script (`-I`):
 * `describe` (builds, projects, declared dependencies, repositories) and
 * `lookup` (which versions of given coordinates the repositories hold). The
 * answers are JSON files below `.gradle/elevate-<id>/out`, never console
 * output. The protocol is fixed in specs/README.md ("The probe protocol").
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { relativeToCwd } from '../shared/process.js';
import type { RunResult } from '../shared/process.js';
import { GradleCommandError, GradleVersionError, gradleFailure, runGradle } from './gradle-command.js';
import type { GradleRunOptions } from './gradle-command.js';
import { PROBE_INIT_SCRIPT } from './gradle-init-script.js';

// ---- documents of the probe protocol ---------------------------------------

export interface GradleRepositoryDocument {
  name: string;
  kind: 'maven' | 'ivy' | 'flatDir' | 'other';
  url: string | null;
}

export interface GradleDependencyDocument {
  configuration: string;
  group: string | null;
  name: string;
  version: string | null;
  strictly: string | null;
  preferred: string | null;
  rejected: string[];
  category: 'platform' | 'enforced-platform' | null;
  fromCatalog: boolean;
  classifier: string | null;
  extension: string | null;
}

export interface GradleConstraintDocument {
  configuration: string;
  group: string | null;
  name: string;
  version: string | null;
  strictly: string | null;
}

export interface GradleProjectDocument {
  path: string;
  name: string;
  dir: string;
  buildFile: string | null;
  group: string | null;
  version: string | null;
  repositories: GradleRepositoryDocument[];
  buildscriptRepositories: GradleRepositoryDocument[];
  dependencies: GradleDependencyDocument[];
  constraints: GradleConstraintDocument[];
  projectDependencies: { configuration: string; path: string }[];
  buildscriptDependencies: { group: string | null; name: string; version: string | null }[];
  /** The names `testClasses` and `assemble` that exist in the project. */
  tasks: string[];
  /** Whether `<dir>/gradle.lockfile` exists. */
  lockfile: boolean;
}

export interface GradleBuildDocument {
  protocol: 1;
  mode: 'describe';
  gradleVersion: string;
  build: {
    name: string;
    kind: 'root' | 'included' | 'buildSrc';
    dir: string;
    repositoriesMode: string | null;
    settingsRepositories: GradleRepositoryDocument[];
    pluginRepositories: GradleRepositoryDocument[];
    settingsPlugins: { id: string; version: string | null }[];
  };
  /** Every project of the build, the root project first. */
  projects: GradleProjectDocument[];
}

export interface LookupPlanEntry {
  id: string;
  /** `build.dir` of the build the project belongs to. */
  buildRoot: string;
  project: string;
  kind: 'module' | 'plugin';
  group: string;
  name: string;
}

export interface LookupPlan {
  protocol: 1;
  publicRepositoryUrls: string[];
  internalGroupPatterns: string[];
  lookups: LookupPlanEntry[];
}

export interface LookupResultDocument {
  id: string;
  /** In the order the rule saw them, duplicates kept. */
  versions: string[];
  /** `null` when Gradle ended with the "not found" failure. */
  error: string | null;
}

interface LookupDocument {
  protocol: 1;
  mode: 'lookup';
  results: LookupResultDocument[];
}

// ---- runs --------------------------------------------------------------------

const PROBE_TIMEOUT_MINUTES = 5;
const MINIMUM_GRADLE = [7, 6] as const;
const SUPPORTED_NOTE = 'checked with 7.6.6, 8.14.3 and 9.8.1';

/** Compares a Gradle version string with the supported minimum. */
function isTooOld(gradleVersion: string): boolean {
  const match = /^(\d+)(?:\.(\d+))?/.exec(gradleVersion);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  return major < MINIMUM_GRADLE[0] || (major === MINIMUM_GRADLE[0] && minor < MINIMUM_GRADLE[1]);
}

interface Scratch {
  /** The directory `.gradle/elevate-<id>` (absolute). */
  dir: string;
  script: string;
  plan: string;
  out: string;
  /** Whether the run created `.gradle` itself. */
  createdGradleDir: boolean;
  gradleDir: string;
}

function createScratch(buildDir: string, plan?: LookupPlan): Scratch {
  const gradleDir = join(buildDir, '.gradle');
  const createdGradleDir = !existsSync(gradleDir);
  const dir = join(gradleDir, `elevate-${randomBytes(4).toString('hex')}`);
  const out = join(dir, 'out');
  mkdirSync(out, { recursive: true });
  const script = join(dir, 'probe.init.gradle');
  writeFileSync(script, PROBE_INIT_SCRIPT, 'utf8');
  const planFile = join(dir, 'plan.json');
  if (plan) writeFileSync(planFile, JSON.stringify(plan), 'utf8');
  return { dir, script, plan: planFile, out, createdGradleDir, gradleDir };
}

/** Removes exactly the scratch directory (and `.gradle` when this run created it and it is empty). */
function removeScratch(scratch: Scratch): void {
  rmSync(scratch.dir, { recursive: true, force: true });
  if (scratch.createdGradleDir) {
    try {
      rmdirSync(scratch.gradleDir);
    } catch {
      // not empty (Gradle keeps its own entries there): leave it
    }
  }
}

function readDocuments<T>(out: string, mode: 'describe' | 'lookup'): T[] {
  if (!existsSync(out)) return [];
  return readdirSync(out)
    .filter((file) => file.startsWith(`${mode}-`) && file.endsWith('.json'))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(out, file), 'utf8')) as T);
}

function runOptions(buildDir: string, rootDir: string): GradleRunOptions {
  return { cwd: buildDir, rootDir, timeoutMs: PROBE_TIMEOUT_MINUTES * 60_000 };
}

/**
 * Describes the Gradle build in `buildDir` and every build it includes (the
 * included builds and `buildSrc`): one document per build.
 *
 * @throws GradleUnavailableError / GradleCommandError / GradleVersionError
 */
export async function runDescribe(buildDir: string, rootDir: string): Promise<GradleBuildDocument[]> {
  const scratch = createScratch(buildDir);
  try {
    const rel = (file: string): string => relativeToCwd(buildDir, file);
    const args = [
      '-q',
      '-m',
      '--console=plain',
      '--no-configuration-cache',
      '-Delevate.mode=describe',
      `-Delevate.outDir=${rel(scratch.out)}`,
      '-I',
      rel(scratch.script),
      'help',
    ];
    const options = runOptions(buildDir, rootDir);
    const result: RunResult = await runGradle(args, options);
    if (result.timedOut || result.exitCode !== 0) {
      throw gradleFailure(result, options, 'describing the build', 'Gradle could not describe the build', PROBE_TIMEOUT_MINUTES);
    }
    const documents = readDocuments<GradleBuildDocument>(scratch.out, 'describe');
    if (documents.length === 0) {
      throw new GradleCommandError(
        'Gradle finished without describing the build, so Elevate cannot read its dependencies.',
        `${result.stdout}\n${result.stderr}`.trim(),
      );
    }
    for (const document of documents) {
      if (isTooOld(document.gradleVersion)) {
        throw new GradleVersionError(
          `Gradle ${document.gradleVersion} is not supported: Elevate needs Gradle 7.6 or newer (${SUPPORTED_NOTE}).`,
        );
      }
    }
    return documents;
  } finally {
    removeScratch(scratch);
  }
}

/**
 * Asks the repositories of the build in `buildDir` (and its included builds)
 * for the versions named in `plan`: one document per build.
 *
 * @throws GradleUnavailableError / GradleCommandError
 */
export async function runLookup(buildDir: string, rootDir: string, plan: LookupPlan): Promise<LookupResultDocument[]> {
  const scratch = createScratch(buildDir, plan);
  try {
    const rel = (file: string): string => relativeToCwd(buildDir, file);
    const args = [
      '-q',
      '-m',
      '--console=plain',
      '--no-configuration-cache',
      '-Delevate.mode=lookup',
      `-Delevate.plan=${rel(scratch.plan)}`,
      `-Delevate.outDir=${rel(scratch.out)}`,
      '-I',
      rel(scratch.script),
      'help',
    ];
    const options = runOptions(buildDir, rootDir);
    const result = await runGradle(args, options);
    if (result.timedOut || result.exitCode !== 0) {
      throw gradleFailure(
        result,
        options,
        'looking up newer versions',
        'Gradle could not look up newer versions',
        PROBE_TIMEOUT_MINUTES,
      );
    }
    return readDocuments<LookupDocument>(scratch.out, 'lookup').flatMap((document) => document.results);
  } finally {
    removeScratch(scratch);
  }
}
