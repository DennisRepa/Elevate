/**
 * A stand-in for Gradle at the process boundary (`runCommand`). It answers a
 * probe run the way the real init script does: it writes the document of the
 * build to the `-Delevate.outDir=` directory, resolved against the working
 * directory of the run (Elevate names it relative to it). `gradle --version`
 * behaves as configured.
 *
 * Use it behind `vi.mock` of `../src/adapters/shared/process.js`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { UnsafeArgumentError } from '../src/adapters/shared/process.js';
import type { RunResult } from '../src/adapters/shared/process.js';
import type {
  GradleBuildDocument,
  GradleDependencyDocument,
  GradleProjectDocument,
  GradleRepositoryDocument,
  LookupPlan,
  LookupResultDocument,
} from '../src/adapters/gradle/gradle-probe.js';

/** A declared dependency from `group:name:version` (an empty group or no version are allowed). */
export function dep(
  configuration: string,
  coordinate: string,
  extra: Partial<GradleDependencyDocument> = {},
): GradleDependencyDocument {
  const [group, name, version] = coordinate.split(':');
  return {
    configuration, group: group || null, name: name!, version: version ?? null, strictly: null, preferred: null,
    rejected: [], category: null, fromCatalog: false, classifier: null, extension: null, ...extra,
  };
}

/** A repository document; `url` defaults to the Maven Central URL. */
export function repo(name: string, url: string | null = 'https://repo.maven.apache.org/maven2/'): GradleRepositoryDocument {
  return { name, kind: 'maven', url };
}

/** A project document with the given fields over empty defaults. */
export function projectDoc(path: string, dir: string, fields: Partial<GradleProjectDocument> = {}): GradleProjectDocument {
  return {
    path, name: path === ':' ? 'root' : path.split(':').pop()!, dir, buildFile: `${dir}/build.gradle`,
    group: null, version: '1.0.0', repositories: [], buildscriptRepositories: [], dependencies: [],
    constraints: [], projectDependencies: [], buildscriptDependencies: [], tasks: [], lockfile: false,
    ...fields,
  };
}

/** A build document with the given fields of `build` over empty defaults. */
export function buildDoc(
  name: string,
  dir: string,
  projects: GradleProjectDocument[],
  build: Partial<GradleBuildDocument['build']> = {},
  gradleVersion = '8.14.3',
): GradleBuildDocument {
  return {
    protocol: 1, mode: 'describe', gradleVersion,
    build: {
      name, kind: 'root', dir, repositoriesMode: null, settingsRepositories: [], pluginRepositories: [],
      settingsPlugins: [], ...build,
    },
    projects,
  };
}

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
  /** Overrides the answer of every describe run (exit code, output, timeout). */
  failure?: Partial<RunResult>;
  /** What the repositories hold, by `group:name`; `error` is the chain of messages Gradle ended with. */
  lookups: Record<string, { versions?: string[]; error?: string | null }> = {};
  /** The versions of a coordinate that `lookups` does not name. */
  defaultVersions: string[] = [];
  /** Coordinates the lookup run writes no answer for. */
  noAnswer = new Set<string>();
  /** Overrides the answer of every lookup run. */
  lookupFailure?: Partial<RunResult>;
  /** The plans lookup runs were given. */
  plans: LookupPlan[] = [];
  /** Outcomes of the describe runs in order, before `failure` applies; `undefined` is a successful run. */
  describeQueue: (Partial<RunResult> | undefined)[] = [];
  /** Outcomes of the verification runs in order; an empty queue means success. */
  verifications: Partial<RunResult>[] = [];
  /** What the lock refresh does: it may rewrite lock files and return a failure to simulate one. */
  refresh?: (args: string[], cwd: string) => Partial<RunResult> | void;
  /** Refuses an argument the Windows command shell would interpret, as the process boundary does there. */
  windows = false;

  get describeRuns(): RecordedGradleRun[] {
    return this.runs.filter((run) => run.args.includes('-Delevate.mode=describe'));
  }

  get lookupRuns(): RecordedGradleRun[] {
    return this.runs.filter((run) => run.args.includes('-Delevate.mode=lookup'));
  }

  get refreshRuns(): RecordedGradleRun[] {
    return this.runs.filter((run) => run.args.includes('--update-locks'));
  }

  /** The runs that are neither a probe nor a lock refresh: the verification builds. */
  get verificationRuns(): RecordedGradleRun[] {
    return this.runs.filter(
      (run) => !run.args.some((arg) => arg.startsWith('-Delevate.mode=')) && !run.args.includes('--update-locks'),
    );
  }

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

    if (this.windows) {
      for (const arg of [command, ...args]) {
        if (/["%!^&|<>\r\n]/.test(arg)) throw new UnsafeArgumentError(arg);
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

    const lookup = args.includes('-Delevate.mode=lookup');
    const describe = args.includes('-Delevate.mode=describe');
    const ok: RunResult = { exitCode: 0, stdout: '', stderr: '', timedOut: false };

    // A lock refresh and a verification build are not probes: they only have an outcome.
    if (!lookup && !describe) {
      if (args.includes('--update-locks')) return { ...ok, ...(this.refresh?.(args, options.cwd) ?? {}) };
      return { ...ok, ...(this.verifications.shift() ?? {}) };
    }

    const queued = describe && this.describeQueue.length > 0 ? this.describeQueue.shift() : undefined;
    const failure = queued ?? (lookup ? this.lookupFailure : this.failure);
    if (failure) {
      return { ...ok, ...failure };
    }
    const outArg = args.find((arg) => arg.startsWith('-Delevate.outDir='));
    if (lookup && outArg) {
      const planArg = args.find((arg) => arg.startsWith('-Delevate.plan='))!;
      const plan = JSON.parse(readFileSync(resolve(options.cwd, planArg.slice('-Delevate.plan='.length)), 'utf8')) as LookupPlan;
      this.plans.push(plan);
      const results: LookupResultDocument[] = plan.lookups
        .filter((entry) => !this.noAnswer.has(`${entry.group}:${entry.name}`))
        .map((entry) => {
          const configured = this.lookups[`${entry.group}:${entry.name}`];
          return {
            id: entry.id,
            versions: configured?.versions ?? this.defaultVersions,
            error: configured?.error ?? null,
          };
        });
      const out = resolve(options.cwd, outArg.slice('-Delevate.outDir='.length));
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'lookup-0000000000.json'), JSON.stringify({ protocol: 1, mode: 'lookup', results }));
      return { exitCode: 0, stdout: ':help SKIPPED\n', stderr: '', timedOut: false };
    }
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
