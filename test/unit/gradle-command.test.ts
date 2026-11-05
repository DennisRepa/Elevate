import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeGradle } from '../gradle-fake.js';
import { cleanupTemp, makeTree } from '../helpers.js';

const gradle = vi.hoisted(() => ({ fake: undefined as unknown as FakeGradle }));
vi.mock('../../src/adapters/shared/process.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/adapters/shared/process.js')>();
  return { ...actual, runCommand: (...args: Parameters<typeof actual.runCommand>) => gradle.fake.runCommand(...args) };
});

import {
  GradleCommandError,
  GradleUnavailableError,
  GradleVersionError,
  findGradleWrapper,
  gradleErrors,
  resetGradleCheck,
} from '../../src/adapters/gradle/gradle-command.js';
import { runDescribe } from '../../src/adapters/gradle/gradle-probe.js';
import type { GradleBuildDocument } from '../../src/adapters/gradle/gradle-probe.js';

const posix = process.platform === 'win32' ? it.skip : it;

function document(dir: string, gradleVersion = '8.14.3'): GradleBuildDocument {
  return {
    protocol: 1, mode: 'describe', gradleVersion,
    build: { name: 'app', kind: 'root', dir, repositoriesMode: null, settingsRepositories: [], pluginRepositories: [], settingsPlugins: [] },
    projects: [],
  };
}

beforeEach(() => {
  gradle.fake = new FakeGradle();
  resetGradleCheck();
});
afterEach(cleanupTemp);

const SETTINGS = { 'settings.gradle': "rootProject.name = 'app'" };

describe('Gradle wrapper and PATH (GRD-35 to GRD-38)', () => {
  posix('GRD-35 The wrapper of the repository is preferred', async () => {
    const root = makeTree({ ...SETTINGS, gradlew: '', 'gradlew.bat': '' });
    gradle.fake.documents = [document(root)];
    await runDescribe(root, root);
    expect(gradle.fake.runs[0]).toMatchObject({ command: 'sh', cwd: root });
    expect(gradle.fake.runs[0]!.args[0]).toBe('./gradlew');
    expect(gradle.fake.versionChecks).toBe(0);
  });

  it('GRD-36 A wrapper above the repository root is not used', async () => {
    const top = makeTree({ gradlew: '', 'repo/.git/HEAD': '', 'repo/settings.gradle': "rootProject.name = 'repo'" });
    const repo = join(top, 'repo');
    expect(findGradleWrapper(repo, repo)).toBeUndefined();
    gradle.fake.versionBehaviour = 'missing';
    await expect(runDescribe(repo, repo)).rejects.toBeInstanceOf(GradleUnavailableError);
  });

  it('GRD-37 Without a wrapper gradle on the PATH is used and checked once', async () => {
    const root = makeTree(SETTINGS);
    gradle.fake.documents = [document(root)];
    await runDescribe(root, root);
    await runDescribe(root, root);
    expect(gradle.fake.runs.map((r) => r.command)).toEqual(['gradle', 'gradle']);
    expect(gradle.fake.versionChecks).toBe(1);
  });

  it.each([
    ['missing', 'Gradle is not available: no Gradle Wrapper (gradlew) in the repository and no `gradle` on the PATH.'],
    ['no-java', "Gradle could not be started: ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH."],
    ['timeout', 'Gradle could not be started: gradle --version timed out.'],
  ] as const)('GRD-38 Gradle is not usable (%s)', async (behaviour, message) => {
    const root = makeTree(SETTINGS);
    gradle.fake.versionBehaviour = behaviour;
    const error = await runDescribe(root, root).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GradleUnavailableError);
    expect((error as Error).message).toBe(message);
  });
});

describe('The describe run (GRD-39 to GRD-47)', () => {
  posix('GRD-39 The describe run has exactly these arguments', async () => {
    const root = makeTree({ ...SETTINGS, gradlew: '' });
    gradle.fake.documents = [document(root)];
    await runDescribe(root, root);
    const run = gradle.fake.runs[0]!;
    const id = /elevate-([0-9a-f]{8})/.exec(run.args.join(' '))![1];
    expect(run.args).toEqual([
      './gradlew', '-q', '-m', '--console=plain', '--no-configuration-cache',
      '-Delevate.mode=describe',
      `-Delevate.outDir=.gradle/elevate-${id}/out`,
      '-I', `.gradle/elevate-${id}/probe.init.gradle`,
      'help',
    ]);
    expect(run.timeoutMs).toBe(5 * 60_000);
  });

  posix('GRD-40 The scratch directory is removed afterwards, whatever the outcome', async () => {
    const root = makeTree({ ...SETTINGS, gradlew: '' });
    gradle.fake.documents = [document(root)];
    await runDescribe(root, root);
    expect(gradle.fake.runs[0]!.scriptExisted).toBe(true);
    expect(existsSync(join(root, '.gradle'))).toBe(false);

    gradle.fake.failure = { exitCode: 1, stderr: 'boom' };
    await expect(runDescribe(root, root)).rejects.toBeInstanceOf(GradleCommandError);
    expect(existsSync(join(root, '.gradle')) ? readdirSync(join(root, '.gradle')) : []).toEqual([]);
  });

  posix('GRD-41 The directory the repository lives in never appears on the command line', async () => {
    const root = makeTree({ 'R&D/settings.gradle': "rootProject.name = 'app'", 'R&D/gradlew': '' });
    const dir = join(root, 'R&D');
    gradle.fake.documents = [document(dir)];
    await runDescribe(dir, dir);
    const run = gradle.fake.runs[0]!;
    expect(run.cwd).toBe(dir);
    expect([run.command, ...run.args].some((a) => a.includes('R&D'))).toBe(false);
  });

  it('GRD-42 A failed run is reported with Gradle\'s own words', async () => {
    const root = makeTree({ ...SETTINGS, gradlew: '' });
    gradle.fake.failure = {
      exitCode: 1,
      stderr: [
        'Picked up JAVA_TOOL_OPTIONS: -Xmx1g',
        'FAILURE: Build failed with an exception.',
        '',
        '* Where:',
        "Build file '/work/app/build.gradle' line: 2",
        '',
        '* What went wrong:',
        "Could not compile build file '/work/app/build.gradle'.",
        '',
        '* Try:',
        '> Run with --stacktrace option to get the stack trace.',
      ].join('\n'),
    };
    const error = await runDescribe(root, root).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GradleCommandError);
    expect((error as Error).message).toBe(
      [
        'Gradle could not describe the build:',
        'FAILURE: Build failed with an exception.',
        '',
        '* Where:',
        "Build file '/work/app/build.gradle' line: 2",
        '',
        '* What went wrong:',
        "Could not compile build file '/work/app/build.gradle'.",
      ].join('\n'),
    );
  });

  it('GRD-42 The details fall back to the standard output and keep the last 30 lines', () => {
    expect(gradleErrors({ stderr: '', stdout: 'only on stdout' })).toBe('only on stdout');
    const many = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n');
    const lines = gradleErrors({ stderr: many, stdout: '' }).split('\n');
    expect(lines).toHaveLength(30);
    expect(lines[0]).toBe('line 11');
  });

  it('GRD-43 A missing JDK is reported as Gradle reports it', async () => {
    const root = makeTree({ ...SETTINGS, gradlew: '' });
    gradle.fake.failure = {
      exitCode: 1,
      stderr: '\nERROR: JAVA_HOME is set to an invalid directory: /opt/missing\n\nPlease set the JAVA_HOME variable.\n',
    };
    await expect(runDescribe(root, root)).rejects.toThrow('ERROR: JAVA_HOME is set to an invalid directory: /opt/missing');
  });

  it('GRD-44 A Gradle too old for the JDK is reported as it is', async () => {
    const root = makeTree({ ...SETTINGS, gradlew: '' });
    gradle.fake.failure = {
      exitCode: 1,
      stderr: [
        'FAILURE: Build failed with an exception.',
        '* What went wrong:',
        "> BUG! exception in phase 'semantic analysis' in source unit '_BuildScript_' Unsupported class file major version 65",
        '* Try:',
        '> Run with --stacktrace option to get the stack trace.',
      ].join('\n'),
    };
    const error = (await runDescribe(root, root).catch((e: unknown) => e)) as Error;
    expect(error.message).toContain('Unsupported class file major version 65');
    expect(error.message).not.toContain('Run with --stacktrace');
  });

  it('GRD-45 A wrapper that cannot download Gradle is named as such', async () => {
    const root = makeTree({
      ...SETTINGS,
      gradlew: '',
      'gradle/wrapper/gradle-wrapper.properties':
        'distributionUrl=https\\://downloads.gradle.org/distributions/gradle-8.14.3-bin.zip\n',
    });
    gradle.fake.failure = {
      exitCode: 1,
      stderr: [
        'Exception in thread "main" java.io.IOException: Unable to tunnel through proxy. Proxy returns "HTTP/1.1 403 Forbidden"',
        '\tat org.gradle.wrapper.Install.forceFetch(SourceFile:2)',
      ].join('\n'),
    };
    const error = (await runDescribe(root, root).catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(GradleCommandError);
    expect(error.message).toBe(
      'The Gradle Wrapper could not download Gradle from https://downloads.gradle.org/distributions/gradle-8.14.3-bin.zip: ' +
        'java.io.IOException: Unable to tunnel through proxy. Proxy returns "HTTP/1.1 403 Forbidden". ' +
        'Check the network connection, the proxy settings and the distributionUrl in gradle/wrapper/gradle-wrapper.properties.',
    );
  });

  it('GRD-46 A describe run that does not finish is stopped and named', async () => {
    const root = makeTree({ ...SETTINGS, gradlew: '' });
    gradle.fake.failure = { exitCode: 1, timedOut: true };
    await expect(runDescribe(root, root)).rejects.toThrow('Gradle timed out after 5 minutes while describing the build.');
  });

  it('GRD-47 A run that writes no description is an error, not an empty build', async () => {
    const root = makeTree({ ...SETTINGS, gradlew: '' });
    gradle.fake.documents = 'none';
    const error = await runDescribe(root, root).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GradleCommandError);
    expect((error as Error).message).toBe('Gradle finished without describing the build, so Elevate cannot read its dependencies.');
  });

  it('GRD-33 Gradle older than 7.6 is refused', async () => {
    const root = makeTree({ ...SETTINGS, gradlew: '' });
    gradle.fake.documents = [document(root, '6.9.4')];
    const error = await runDescribe(root, root).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GradleVersionError);
    expect((error as Error).message).toBe(
      'Gradle 6.9.4 is not supported: Elevate needs Gradle 7.6 or newer (checked with 7.6.6, 8.14.3 and 9.8.1).',
    );
  });
});
