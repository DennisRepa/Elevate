/**
 * A stand-in for Gradle at the process boundary (`runCommand`). It answers a
 * probe run the way the real init script does: it writes the document of the
 * build to the `-Delevate.outDir=` directory, resolved against the working
 * directory of the run (Elevate names it relative to it). `gradle --version`
 * behaves as configured.
 *
 * Use it behind `vi.mock` of `../src/adapters/shared/process.js`.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { RunResult } from '../src/adapters/shared/process.js';
import type { GradleBuildDocument } from '../src/adapters/gradle/gradle-probe.js';

export interface RecordedGradleRun {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
  /** Whether the init script existed while the run was in progress. */
  scriptExisted: boolean;
}

export type VersionBehaviour = 'ok' | 'missing' | 'no-java' | 'timeout';

export class FakeGradle {
  readonly runs: RecordedGradleRun[] = [];
  versionBehaviour: VersionBehaviour = 'ok';
  versionChecks = 0;
  /** Documents written for a describe run, per working directory; falls back to `documents`. */
  documents: GradleBuildDocument[] | 'none' = 'none';
  /** Overrides the answer of every probe run (exit code, output, timeout). */
  failure?: Partial<RunResult>;

  runCommand = async (command: string, args: string[], options: { cwd: string; timeoutMs?: number }): Promise<RunResult> => {
    if (command === 'gradle' && args.length === 1 && args[0] === '--version') {
      this.versionChecks++;
      switch (this.versionBehaviour) {
        case 'missing':
          throw new Error('spawn gradle ENOENT');
        case 'no-java':
          return {
            exitCode: 1,
            stdout: '',
            stderr: "ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH.\n",
            timedOut: false,
          };
        case 'timeout':
          return { exitCode: 1, stdout: '', stderr: '', timedOut: true };
        default:
          return { exitCode: 0, stdout: 'Gradle 8.14.3', stderr: '', timedOut: false };
      }
    }

    const scriptArg = args[args.indexOf('-I') + 1];
    const run: RecordedGradleRun = {
      command,
      args,
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      scriptExisted: scriptArg ? existsSync(resolve(options.cwd, scriptArg)) : false,
    };
    this.runs.push(run);

    if (this.failure) {
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false, ...this.failure };
    }
    const outArg = args.find((arg) => arg.startsWith('-Delevate.outDir='));
    if (outArg && this.documents !== 'none') {
      const out = resolve(options.cwd, outArg.slice('-Delevate.outDir='.length));
      mkdirSync(out, { recursive: true });
      this.documents.forEach((document, index) => {
        writeFileSync(join(out, `describe-${String(index).padStart(10, '0')}.json`), JSON.stringify(document));
      });
    }
    return { exitCode: 0, stdout: ':help SKIPPED\n', stderr: '', timedOut: false };
  };
}
