import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAbsolute, join, relative } from 'node:path';

// The process boundary. By default it is the real one (WIN-04, WIN-05); tests
// that must not start Maven swap in a recording double.
const process_ = vi.hoisted(() => ({ runCommand: vi.fn() }));
vi.mock('../../src/adapters/shared/process.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/adapters/shared/process.js')>();
  process_.runCommand.mockImplementation(actual.runCommand);
  return { ...actual, runCommand: process_.runCommand };
});

import { relativeToCwd, runMaven } from '../../src/adapters/maven/maven-command.js';
import { DEFAULT_MAVEN_PLUGINS, ScratchDirectory, queryNewerVersions, readEffectivePoms } from '../../src/adapters/maven/maven-resolution.js';
import { UnsafeArgumentError, runCommand } from '../../src/adapters/shared/process.js';
import { FakeMaven } from '../maven-fake.js';
import { cleanupTemp, makeTree, pom } from '../helpers.js';

const IS_WINDOWS = process.platform === 'win32';
const POM = pom('<groupId>g</groupId><artifactId>shop</artifactId><version>1</version>');

let maven: FakeMaven;
beforeEach(async () => {
  maven = new FakeMaven();
  const actual = await vi.importActual<typeof import('../../src/adapters/shared/process.js')>('../../src/adapters/shared/process.js');
  process_.runCommand.mockImplementation(actual.runCommand);
});
afterEach(cleanupTemp);

/** Routes the process boundary to the recording Maven double. */
function recordProcesses(): void {
  process_.runCommand.mockImplementation(maven.runCommand);
}

/** The text of the command and every argument of every recorded run. */
function commandLines(): string[] {
  return maven.runs.flatMap((run) => [run.command ?? '', ...run.args]);
}

/** A Maven project in a directory whose path contains "R&D". */
function projectInRandD(): string {
  const root = makeTree({ 'R&D/shop/pom.xml': POM });
  return join(root, 'R&D', 'shop');
}

describe('files inside the working directory are named relative to it', () => {
  it.skipIf(!IS_WINDOWS).each([
    ['C:\\R&D\\shop', 'C:\\R&D\\shop\\pom.xml', 'pom.xml'],
    ['C:\\R&D\\shop\\app', 'C:\\R&D\\shop\\mvnw.cmd', '..\\mvnw.cmd'],
    ['C:\\R&D\\shop', 'C:\\R&D\\shop\\target\\.elevate-1a2b\\out.xml', 'target\\.elevate-1a2b\\out.xml'],
    ['C:\\R&D\\shop', 'D:\\cache\\pom.xml', 'D:\\cache\\pom.xml'],
  ])('WIN-06 Paths are made relative to the working directory (windows): %s + %s', (cwd, file, argument) => {
    expect(relativeToCwd(cwd, file)).toBe(argument);
  });

  it.skipIf(IS_WINDOWS).each([
    ['/work/R&D/shop', '/work/R&D/shop/pom.xml', 'pom.xml'],
    ['/work/R&D/shop/a', '/work/R&D/shop/mvnw', '../mvnw'],
  ])('WIN-06 Paths are made relative to the working directory (posix): %s + %s', (cwd, file, argument) => {
    expect(relativeToCwd(cwd, file)).toBe(argument);
  });

  it('WIN-01 Reading the effective POM does not put the project directory on the command line', async () => {
    const project = projectInRandD();
    recordProcesses();
    const scratch = new ScratchDirectory(project);
    try {
      await readEffectivePoms(join(project, 'pom.xml'), project, project, scratch, DEFAULT_MAVEN_PLUGINS);
    } finally {
      scratch.dispose();
    }

    const [run] = maven.runs.filter((r) => r.args.some((arg) => arg.includes(':effective-pom')));
    expect(run!.cwd).toBe(project);
    expect(run!.args[run!.args.indexOf('-f') + 1]).toBe('pom.xml');
    const output = run!.args.find((arg) => arg.startsWith('-Doutput='))!.slice('-Doutput='.length);
    expect(isAbsolute(output)).toBe(false);
    expect(output).toBe(relative(project, join(scratch.path, 'effective-pom.xml')));
    expect(commandLines().filter((line) => line.includes('R&D'))).toEqual([]);
  });

  it('WIN-02 Looking up newer versions does not put the project directory on the command line', async () => {
    const project = projectInRandD();
    recordProcesses();
    const scratch = new ScratchDirectory(project);
    try {
      await queryNewerVersions(
        [{ groupId: 'com.google.guava', artifactId: 'guava', version: '1' }],
        { dependencies: [], managedDependencies: [] },
        project,
        project,
        scratch,
        DEFAULT_MAVEN_PLUGINS,
      );
    } finally {
      scratch.dispose();
    }

    const [run] = maven.runs.filter((r) => r.args.some((arg) => arg.includes(':dependency-updates-report')));
    expect(run!.cwd).toBe(project);
    const probe = run!.args[run!.args.indexOf('-f') + 1]!;
    expect(isAbsolute(probe)).toBe(false);
    expect(probe).toBe(relative(project, join(scratch.path, 'probe', 'pom.xml')));
    expect(commandLines().filter((line) => line.includes('R&D'))).toEqual([]);
  });

  it('WIN-07 The Maven Wrapper is started by its relative path', async () => {
    const wrapperName = IS_WINDOWS ? 'mvnw.cmd' : 'mvnw';
    const root = makeTree({ [`R&D/shop/${wrapperName}`]: '', 'R&D/shop/pom.xml': POM, 'R&D/shop/app/pom.xml': POM });
    const repository = join(root, 'R&D', 'shop');
    const moduleDir = join(repository, 'app');
    recordProcesses();

    await runMaven(['validate'], { cwd: moduleDir, rootDir: repository });

    const [run] = maven.runs;
    expect(run!.cwd).toBe(moduleDir);
    const expected = relative(moduleDir, join(repository, wrapperName));
    // On POSIX the wrapper is the script `sh` runs; on Windows it is the command itself.
    const addressed = IS_WINDOWS ? run!.command : run!.args[0];
    expect(addressed).toBe(expected);
    expect(commandLines().filter((line) => line.includes('R&D'))).toEqual([]);
  });
});

describe('an argument that is unsafe for cmd.exe is rejected with an explanation', () => {
  it.skipIf(!IS_WINDOWS)('WIN-04 The message names the argument, the characters and a remedy', async () => {
    const failure = await runCommand('node', ['a&b'], { cwd: process.cwd() }).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(UnsafeArgumentError);
    expect((failure as Error).message).toBe(
      'Cannot pass "a&b" to the Windows command shell: it contains one of the characters " % ! ^ & | < > or a line break, which cmd.exe would interpret. If this is part of a directory or file name, rename it or move the project to a path without these characters.',
    );
  });

  it('WIN-08 The message is the same on every platform', () => {
    const error = new UnsafeArgumentError('50%');
    expect(error.name).toBe('UnsafeArgumentError');
    expect(error.message.startsWith('Cannot pass "50%" to the Windows command shell:')).toBe(true);
  });
});

describe('other platforms pass arguments without a shell and without restriction', () => {
  it.skipIf(IS_WINDOWS)('WIN-05 An argument with shell metacharacters reaches the program unchanged', async () => {
    const result = await runCommand('node', ['-e', 'process.stdout.write(process.argv[1])', 'a&b|c'], {
      cwd: process.cwd(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('a&b|c');
  });
});
