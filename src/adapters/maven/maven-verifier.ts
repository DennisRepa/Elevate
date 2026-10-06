/**
 * Elevate — Maven verification.
 *
 * Compiles main and test sources of every module affected by the update.
 * Within a reactor this is `-pl <changed modules> -amd`: the modules whose
 * POMs changed plus all modules that depend on them, because a version change
 * in an internal library breaks its consumers, not the library itself.
 * A change to the aggregator POM, or to a POM outside the reactor, rebuilds
 * the whole reactor.
 */

import { dirname, join, relative, resolve } from 'node:path';
import type { VerificationOptions, VerificationPort, VerificationResult } from '../../domain/ports.js';
import type { ProjectModule } from '../../domain/models.js';
import { runShellScript } from '../shared/process.js';
import type { RunResult } from '../shared/process.js';
import { MavenUnavailableError, mavenErrors, runMaven } from './maven-command.js';
import { MavenProject } from './maven-project.js';

const VERIFY_TIMEOUT_MS = 30 * 60_000;

export class MavenVerificationAdapter implements VerificationPort {
  async verify(module: ProjectModule, rootDir: string, options: VerificationOptions = {}): Promise<VerificationResult> {
    if (options.customScript) {
      const label = options.customLabel || options.customScript;
      const result = await runShellScript(options.customScript, { cwd: module.path, timeoutMs: VERIFY_TIMEOUT_MS });
      return result.exitCode === 0
        ? { status: 'clean', details: 'Verification script succeeded.', label }
        : { status: 'warn', details: failureDetails(result), label };
    }

    const plan = planBuild(module, rootDir, options.changedFiles ?? []);
    const label = `Maven build (${['test-compile', ...plan.args].join(' ')})`;

    try {
      const result = await runMaven(['-q', 'test-compile', ...plan.args], {
        cwd: plan.cwd,
        rootDir,
        timeoutMs: VERIFY_TIMEOUT_MS,
      });
      if (result.exitCode === 0) {
        return { status: 'clean', details: 'All affected modules compile, including tests.', label };
      }
      const details = result.timedOut ? 'Maven build timed out.' : failureDetails(result);
      return { status: 'warn', details, label };
    } catch (err) {
      if (err instanceof MavenUnavailableError) return { status: 'warn', details: err.message, label };
      throw err;
    }
  }
}

/** Maven's error lines, or the exit code when the command printed nothing. */
function failureDetails(result: RunResult): string {
  const output = `${result.stdout}\n${result.stderr}`.trim();
  return output ? mavenErrors(output) : `Exited with code ${result.exitCode}.`;
}

interface BuildPlan {
  cwd: string;
  args: string[];
}

/** Chooses where to run Maven and which reactor modules to build. */
export function planBuild(module: ProjectModule, rootDir: string, changedFiles: readonly string[]): BuildPlan {
  const aggregatorDir = module.aggregatorDir;
  if (!aggregatorDir) return { cwd: module.path, args: [] };

  const project = MavenProject.load(rootDir);
  const files = changedFiles.length > 0 ? changedFiles : [join(module.path, 'pom.xml')];
  const selected = new Set<string>();

  for (const file of files) {
    const pom = project.pomAt(file);
    const dir = resolve(dirname(file));
    // Not part of this reactor, or the aggregator itself: everything may be affected.
    if (!pom || project.aggregatorDirOf(pom) !== aggregatorDir || dir === resolve(aggregatorDir)) {
      return { cwd: aggregatorDir, args: [] };
    }
    selected.add(relative(aggregatorDir, dir).replace(/\\/g, '/'));
  }

  return { cwd: aggregatorDir, args: ['-pl', [...selected].join(','), '-amd'] };
}
