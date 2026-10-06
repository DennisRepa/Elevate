/**
 * A stand-in for Maven. It answers the two kinds of run Elevate makes the way
 * the real tools do: `help:effective-pom` writes the effective POM to the
 * `-Doutput=` file, and the versions plugin writes its XML report next to the
 * probe POM given with `-f`. Both paths are resolved against the working
 * directory of the run, because Elevate names them relative to it.
 *
 * Use it behind `vi.mock` of `runMaven` (`maven.run`) or of the process
 * boundary (`maven.runCommand`).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { RunResult } from '../src/adapters/shared/process.js';
import type { MavenRunOptions } from '../src/adapters/maven/maven-command.js';

export interface RecordedRun {
  /** The program, for runs recorded at the process boundary. */
  command?: string;
  args: string[];
  cwd: string;
  /** `groupId:artifactId` of the artifacts a versions run was asked about. */
  lookedUp: string[];
}

export interface FakeMavenAnswers {
  /** Effective POM XML written for every `effective-pom` run. */
  effectivePom?: string;
  /** Newer versions per `groupId:artifactId`, ascending, for every versions run. */
  newerVersions?: Record<string, string[]>;
  /** When set, every run fails with this output and writes nothing. */
  failure?: string;
}

export class FakeMaven {
  readonly runs: RecordedRun[] = [];

  constructor(public answers: FakeMavenAnswers = {}) {}

  /** The arguments of every run that contained the given goal. */
  argsOfGoal(goalPart: string): string[][] {
    return this.runs.filter((run) => run.args.some((arg) => arg.includes(goalPart))).map((run) => run.args);
  }

  /** Every `groupId:artifactId` sent to the versions plugin. */
  get lookedUp(): string[] {
    return this.runs.flatMap((run) => run.lookedUp);
  }

  /** Replacement for `runMaven`. */
  run = async (args: string[], options: MavenRunOptions): Promise<RunResult> => this.simulate(undefined, args, options.cwd);

  /** Replacement for `runCommand` of the process boundary. */
  runCommand = async (command: string, args: string[], options: { cwd: string }): Promise<RunResult> => {
    if (args.length === 1 && args[0] === '-v') return { exitCode: 0, stdout: 'Apache Maven', stderr: '', timedOut: false };
    return this.simulate(command, args, options.cwd);
  };

  private simulate(command: string | undefined, args: string[], cwd: string): RunResult {
    const run: RecordedRun = { command, args, cwd, lookedUp: [] };
    this.runs.push(run);

    if (this.answers.failure !== undefined) {
      return { exitCode: 1, stdout: this.answers.failure, stderr: '', timedOut: false };
    }

    const output = args.find((arg) => arg.startsWith('-Doutput='))?.slice('-Doutput='.length);
    if (args.some((arg) => arg.includes(':effective-pom')) && output) {
      writeFileSync(resolve(cwd, output), this.answers.effectivePom ?? effectivePom([]), 'utf8');
    }

    const pomArg = args[args.indexOf('-f') + 1];
    if (args.some((arg) => arg.includes(':dependency-updates-report')) && pomArg) {
      const probe = resolve(cwd, pomArg);
      run.lookedUp = probedArtifacts(readFileSync(probe, 'utf8'));
      const report = join(dirname(probe), 'target', 'dependency-updates-report.xml');
      mkdirSync(dirname(report), { recursive: true });
      writeFileSync(report, updatesReport(run.lookedUp, this.answers.newerVersions ?? {}), 'utf8');
    }
    return { exitCode: 0, stdout: '[INFO] BUILD SUCCESS', stderr: '', timedOut: false };
  }
}

/** The `groupId:artifactId` pairs a probe POM manages. */
function probedArtifacts(probePom: string): string[] {
  return [...probePom.matchAll(/<dependency><groupId>([^<]*)<\/groupId><artifactId>([^<]*)<\/artifactId>/g)].map(
    (match) => `${match[1]}:${match[2]}`,
  );
}

/** An effective POM with the given dependencies. */
export function effectivePom(dependencies: { groupId: string; artifactId: string; version: string; scope?: string }[]): string {
  const entries = dependencies
    .map(
      (d) =>
        `<dependency><groupId>${d.groupId}</groupId><artifactId>${d.artifactId}</artifactId><version>${d.version}</version>` +
        `<scope>${d.scope ?? 'compile'}</scope></dependency>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<project><groupId>g</groupId><artifactId>a</artifactId><version>1</version><dependencies>${entries}</dependencies></project>\n`;
}

/** The versions plugin's XML report: one entry per probed artifact. */
export function updatesReport(artifacts: readonly string[], newerVersions: Record<string, string[]>): string {
  const entries = artifacts
    .map((key) => {
      const [groupId, artifactId] = key.split(':');
      const minors = (newerVersions[key] ?? []).map((v) => `<minor>${v}</minor>`).join('');
      return `<dependencyManagement><groupId>${groupId}</groupId><artifactId>${artifactId}</artifactId><minors>${minors}</minors></dependencyManagement>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<DependencyUpdatesReport><dependencyManagements>${entries}</dependencyManagements></DependencyUpdatesReport>\n`;
}
