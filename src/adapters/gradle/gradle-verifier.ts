/**
 * Elevate — Gradle verification.
 *
 * Lets the build judge the update: a Gradle run that resolves and compiles what
 * the change can affect. The projects checked are the projects of the module's
 * build that the changed files can affect (specs/25):
 *
 *  - a file in the directory of a project P that is not the root project (build
 *    script, properties, lock file): P and every project that depends on P
 *    through `project(...)`, directly or indirectly;
 *  - a file of the root project (root build script, gradle.properties, the
 *    settings file, `gradle/libs.versions.toml`, the root lock file): every
 *    project of the build;
 *  - no changed file known: the project of the module and its dependents.
 *
 * Each affected project is checked with `testClasses` (main and test sources
 * compile), else `assemble`, else nothing. Without any task the run is `help`,
 * which configures the build and compiles `buildSrc`. A failed build is a
 * warning that quotes Gradle; dependency verification
 * (`gradle/verification-metadata.xml`) is never regenerated.
 */

import { resolve, sep } from 'node:path';
import type { VerificationOptions, VerificationPort, VerificationResult } from '../../domain/ports.js';
import type { ProjectModule } from '../../domain/models.js';
import { UnsafeArgumentError, runShellScript } from '../shared/process.js';
import type { RunResult } from '../shared/process.js';
import { GradleCommandError, GradleUnavailableError, GradleVersionError, gradleErrors, runGradle } from './gradle-command.js';
import { runDescribe } from './gradle-probe.js';
import type { GradleBuildDocument, GradleProjectDocument } from './gradle-probe.js';

const VERIFY_TIMEOUT_MINUTES = 30;
const FALLBACK_LABEL = 'Gradle build';
const TASKS = ['testClasses', 'assemble'] as const;

const HELP_ONLY = 'Only the configuration of the build and buildSrc were checked: no project with a compile task is affected.';

export class GradleVerificationAdapter implements VerificationPort {
  async verify(module: ProjectModule, rootDir: string, options: VerificationOptions = {}): Promise<VerificationResult> {
    const buildDir = module.buildDir ?? module.path;

    if (options.customScript) {
      const label = options.customLabel || options.customScript;
      const result = await runShellScript(options.customScript, { cwd: buildDir, timeoutMs: VERIFY_TIMEOUT_MINUTES * 60_000 });
      return result.exitCode === 0
        ? { status: 'clean', details: 'Verification script succeeded.', label }
        : { status: 'warn', details: result.timedOut ? 'Verification script timed out.' : failureDetails(result), label };
    }

    try {
      const documents = await runDescribe(buildDir, rootDir);
      const plan = planGradleBuild(module, documents, options.changedFiles ?? []);
      const result = await runGradle(['-q', '--console=plain', ...plan.tasks], {
        cwd: buildDir,
        rootDir,
        timeoutMs: VERIFY_TIMEOUT_MINUTES * 60_000,
      });
      if (result.exitCode === 0 && !result.timedOut) {
        const onlyHelp = plan.tasks.length === 1 && plan.tasks[0] === 'help';
        return { status: 'clean', details: onlyHelp ? HELP_ONLY : 'All affected projects build successfully.', label: plan.label };
      }
      return { status: 'warn', details: result.timedOut ? 'Gradle build timed out.' : failureDetails(result), label: plan.label };
    } catch (err) {
      // Gradle that cannot be started, or a build that cannot be described, is a warning, not a crash.
      if (
        err instanceof GradleUnavailableError ||
        err instanceof GradleCommandError ||
        err instanceof GradleVersionError ||
        err instanceof UnsafeArgumentError
      ) {
        return { status: 'warn', details: err.message, label: FALLBACK_LABEL };
      }
      throw err;
    }
  }
}

/** Gradle's own words for a failure, or the exit code when it printed nothing. */
function failureDetails(result: RunResult): string {
  return gradleErrors(result) || `Exited with code ${result.exitCode}.`;
}

function sameOrInside(dir: string, file: string): boolean {
  const base = resolve(dir);
  const target = resolve(file);
  return target === base || target.startsWith(base + sep);
}

/**
 * Chooses the tasks that check what a change can affect. A pure function of the
 * described build: `documents` is what the describe run of the module's build
 * returned, `changedFiles` are absolute paths (none when unknown).
 */
export function planGradleBuild(
  module: ProjectModule,
  documents: readonly GradleBuildDocument[],
  changedFiles: readonly string[],
): { tasks: string[]; label: string } {
  const help = { tasks: ['help'], label: `${FALLBACK_LABEL} (help)` };
  const document = documents.find((doc) => resolve(doc.build.dir) === resolve(module.buildRoot ?? module.buildDir ?? module.path));
  // buildSrc has no selector: every run compiles it.
  if (!document || document.build.kind === 'buildSrc') return help;

  const projects = document.projects;
  const own = projects.find((project) => resolve(project.dir) === resolve(module.path));
  const dependents = (start: readonly string[]): Set<string> => {
    const affected = new Set(start);
    for (let grew = true; grew; ) {
      grew = false;
      for (const project of projects) {
        if (!affected.has(project.path) && project.projectDependencies.some((dependency) => affected.has(dependency.path))) {
          affected.add(project.path);
          grew = true;
        }
      }
    }
    return affected;
  };

  // The project whose directory is the deepest one that holds the file.
  const ownerOf = (file: string): GradleProjectDocument | undefined =>
    projects
      .filter((project) => sameOrInside(project.dir, file))
      .sort((a, b) => resolve(b.dir).length - resolve(a.dir).length)[0];

  let affected = new Set<string>();
  for (const file of changedFiles) {
    const owner = ownerOf(file);
    if (!owner) continue;
    if (owner.path === ':') {
      affected = new Set(projects.map((project) => project.path));
      break;
    }
    for (const path of dependents([owner.path])) affected.add(path);
  }
  if (affected.size === 0 && own) affected = dependents([own.path]);

  const chosen = projects
    .filter((project) => affected.has(project.path))
    .map((project) => ({ project, task: TASKS.find((task) => project.tasks.includes(task)) }))
    .filter((entry): entry is { project: GradleProjectDocument; task: (typeof TASKS)[number] } => entry.task !== undefined);

  // In the root build, running a task in every project that has it is exactly what is wanted
  // when the whole build is affected and those are the projects that need it.
  const inRootBuild = document.build.kind === 'root';
  const wholeBuild = affected.size === projects.length;
  const unqualified = TASKS.filter((task) => {
    const needed = chosen.filter((entry) => entry.task === task).length;
    return inRootBuild && wholeBuild && needed > 0 && needed === projects.filter((project) => project.tasks.includes(task)).length;
  });

  const prefix = inRootBuild ? '' : `:${document.build.name}`;
  const qualified = chosen
    .filter((entry) => !unqualified.includes(entry.task))
    .map((entry) => `${prefix}${entry.project.path === ':' ? '' : entry.project.path}:${entry.task}`)
    .sort();

  const tasks = [...unqualified, ...qualified];
  if (tasks.length === 0) return help;
  return { tasks, label: `${FALLBACK_LABEL} (${tasks.join(' ')})` };
}
