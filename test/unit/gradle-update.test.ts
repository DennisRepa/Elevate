import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeGradle, buildDoc, dep, projectDoc } from '../gradle-fake.js';
import { scan } from '../gradle-scan.js';
import type { Scanned, Scenario } from '../gradle-scan.js';
import { cleanupTemp } from '../helpers.js';

const gradle = vi.hoisted(() => ({ fake: undefined as unknown as FakeGradle }));
vi.mock('../../src/adapters/shared/process.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/adapters/shared/process.js')>();
  return { ...actual, runCommand: (...args: Parameters<typeof actual.runCommand>) => gradle.fake.runCommand(...args) };
});

import { resetGradleCheck } from '../../src/adapters/gradle/gradle-command.js';
import { findLockFiles } from '../../src/adapters/gradle/gradle-locks.js';
import { GradleEcosystemStrategy } from '../../src/adapters/gradle/gradle-strategy.js';
import { GradleUpdaterAdapter } from '../../src/adapters/gradle/gradle-updater.js';
import { GradleVerificationAdapter, planGradleBuild } from '../../src/adapters/gradle/gradle-verifier.js';
import type { GradleProjectDocument } from '../../src/adapters/gradle/gradle-probe.js';
import { UpdateSelectionError, selectRequested } from '../../src/application/update-selection.js';
import { runUpdateWorkflow } from '../../src/application/update-workflow.js';
import type { UpdateWorkflowOptions } from '../../src/application/update-workflow.js';
import type { ProjectModule, ScanResult, UpdateCandidate } from '../../src/domain/models.js';
import { InstallError } from '../../src/domain/ports.js';

beforeEach(() => {
  gradle.fake = new FakeGradle();
  resetGradleCheck();
});
afterEach(cleanupTemp);

const updater = new GradleUpdaterAdapter();
const strategy = new GradleEcosystemStrategy();
const TASKS = ['testClasses', 'assemble'];
const SCRIPT = "dependencies {\n    implementation project(':core')\n    implementation 'org.example:lib:1.0'\n}";
const LOCK = 'org.example:lib:1.0=compileClasspath,runtimeClasspath\n';
const noop = () => {};

type Prepared = Scanned & { update: UpdateCandidate };

/**
 * The background of specs/25: `:app` depends on `:core`, all projects have the
 * tasks, and the update is `org.example:lib` from 1.0 to 1.1 in `app/build.gradle`.
 */
async function prepare(scenario: Scenario & { core?: Partial<GradleProjectDocument>; locks?: string[] } = {}): Promise<Prepared> {
  const { core, locks, files, appExtras, rootExtras, projects, ...rest } = scenario;
  const scanned = await scan(gradle.fake, {
    ...rest,
    files: { 'app/build.gradle': SCRIPT, ...files },
    appExtras: { tasks: TASKS, projectDependencies: [{ configuration: 'implementation', path: ':core' }], ...appExtras },
    rootExtras: { tasks: TASKS, ...rootExtras },
    projects: (root) => [
      projectDoc(':core', join(root, 'core'), { tasks: TASKS, buildFile: join(root, 'core/build.gradle'), ...core }),
      ...(projects?.(root) ?? []),
    ],
  });
  // What counts from here on are the processes of the update.
  gradle.fake.runs.length = 0;
  gradle.fake.plans.length = 0;
  if (locks) {
    for (const dir of locks) {
      mkdirSync(join(scanned.root, dir), { recursive: true });
      writeFileSync(join(scanned.root, dir, 'gradle.lockfile'), LOCK);
    }
    gradle.fake.refresh = () => {
      for (const dir of locks) {
        const file = join(scanned.root, dir, 'gradle.lockfile');
        writeFileSync(file, readFileSync(file, 'utf8').replaceAll('lib:1.0', 'lib:1.1'));
      }
    };
  }
  return { ...scanned, update: scanned.result.candidates[0]! };
}

/** The projects of a build with locks, for scenarios that refresh them. */
const LOCKED = { appExtras: { lockfile: true }, core: { lockfile: true }, locks: ['app', 'core'] };

const read = (root: string, file: string) => readFileSync(join(root, file), 'utf8');
const shown = (root: string, files: string[]) => files.map((f) => relative(root, f).replace(/\\/g, '/'));

async function workflow(prepared: Prepared, options: UpdateWorkflowOptions = {}, updates: UpdateCandidate[] = [prepared.update]) {
  return runUpdateWorkflow(strategy, prepared.module, prepared.root, updates, options);
}

describe('writing the versions (GRDUPD-01 to GRDUPD-05)', () => {
  it('GRDUPD-01 The outcome says what was written, and no process is started', async () => {
    const { root, module, update } = await prepare();
    const original = read(root, 'app/build.gradle');
    const outcome = await updater.applyUpdates(module, root, [update], noop);
    expect(read(root, 'app/build.gradle')).toBe(original.replace('1.0', '1.1'));
    expect(outcome).toEqual({
      updatedCount: 1,
      auditSeverity: 'clean',
      auditMessage: 'Updated 1 version declaration(s) in 1 file(s).',
      integrityViolations: [],
    });
    expect(gradle.fake.runs).toEqual([]);
  });

  const twoPlaces = {
    files: {
      'gradle.properties': 'v=1.0',
      'app/build.gradle': "dependencies {\n    implementation \"org.example:lib:$v\"\n    testImplementation 'org.example:lib:1.0'\n}",
    },
    deps: [dep('implementation', 'org.example:lib:1.0'), dep('testImplementation', 'org.example:lib:1.0')],
  };

  it('GRDUPD-02 Declarations in several files are written together', async () => {
    const { root, module, update } = await prepare(twoPlaces);
    const outcome = await updater.applyUpdates(module, root, [update], noop);
    expect(read(root, 'gradle.properties')).toBe('v=1.1');
    expect(read(root, 'app/build.gradle')).toContain("testImplementation 'org.example:lib:1.1'");
    expect(outcome.auditMessage).toBe('Updated 1 version declaration(s) in 2 file(s).');
  });

  it('GRDUPD-03 A candidate without a known declaration is refused and nothing is changed', async () => {
    const { root, module, update } = await prepare();
    const original = read(root, 'app/build.gradle');
    const other: UpdateCandidate = {
      ...update,
      coordinate: { ...update.coordinate, identifier: 'org.example:other' },
      declaration: undefined,
      declarations: undefined,
    };
    const error = await updater.applyUpdates(module, root, [update, other], noop).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InstallError);
    expect((error as Error).message).toBe('No version declaration known for org.example:other; rescan the module.');
    expect(read(root, 'app/build.gradle')).toBe(original);
  });

  it('GRDUPD-04 The files that may change are the declarations and the lock files of the build', async () => {
    const { root, module, update } = await prepare({
      ...twoPlaces,
      files: { ...twoPlaces.files, 'gradle/verification-metadata.xml': '<verification-metadata/>' },
    });
    for (const dir of ['app', 'core', 'buildSrc', 'build']) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, 'gradle.lockfile'), '# lock');
    }
    const files = shown(root, updater.affectedFiles(module, root, [update]));
    expect(files).toEqual(['gradle.properties', 'app/build.gradle', 'app/gradle.lockfile', 'buildSrc/gradle.lockfile', 'core/gradle.lockfile']);
    expect(files).not.toContain('gradle/verification-metadata.xml');
    expect(shown(root, findLockFiles(root))).not.toContain('build/gradle.lockfile');
  });

  it('GRDUPD-05 Nothing is started when the build has no lock files', async () => {
    const { root, module, update } = await prepare();
    await updater.applyUpdates(module, root, [update], noop);
    expect(gradle.fake.runs).toEqual([]);
  });

  it('A share of one text between candidates must agree on the target', async () => {
    const files = {
      'gradle.properties': 'jacksonVersion=1.0',
      'app/build.gradle': 'dependencies {\n    implementation "org.example:core:$jacksonVersion"\n    implementation "org.example:databind:$jacksonVersion"\n}',
    };
    const { root, module, result } = await prepare({
      files,
      deps: [dep('implementation', 'org.example:core:1.0'), dep('implementation', 'org.example:databind:1.0')],
      lookups: { 'org.example:core': { versions: ['1.0', '1.1'] }, 'org.example:databind': { versions: ['1.0', '1.2'] } },
    });
    const original = read(root, 'gradle.properties');
    const error = await updater.applyUpdates(module, root, result.candidates, noop).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InstallError);
    expect((error as Error).message).toBe(
      'org.example:databind and org.example:core share the property $jacksonVersion in gradle.properties but target different versions (1.2 vs 1.1).',
    );
    expect(read(root, 'gradle.properties')).toBe(original);
  });

  it('Two candidates that share a text and agree write it once', async () => {
    const { root, module, result } = await prepare({
      files: {
        'gradle.properties': 'jacksonVersion=1.0',
        'app/build.gradle': 'dependencies {\n    implementation "org.example:core:$jacksonVersion"\n    implementation "org.example:databind:$jacksonVersion"\n}',
      },
      deps: [dep('implementation', 'org.example:core:1.0'), dep('implementation', 'org.example:databind:1.0')],
    });
    const outcome = await updater.applyUpdates(module, root, result.candidates, noop);
    expect(read(root, 'gradle.properties')).toBe('jacksonVersion=1.1');
    expect(outcome.auditMessage).toBe('Updated 2 version declaration(s) in 1 file(s).');
  });

  it('GRDDEC-35 A file that changed since the scan is not overwritten', async () => {
    const { root, module, update } = await prepare();
    const changed = SCRIPT.replace('lib:1.0', 'lib:1.0.1');
    writeFileSync(join(root, 'app/build.gradle'), changed);
    const error = await updater.applyUpdates(module, root, [update], noop).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InstallError);
    expect((error as Error).message).toMatch(/^app\/build\.gradle: .*changed since it was scanned/);
    expect(read(root, 'app/build.gradle')).toBe(changed);
  });

  it('GRDDEC-36 Every edit is computed before the first file is written', async () => {
    const { root, module, result } = await prepare({
      files: {
        'gradle.properties': 'v=1.0',
        'app/build.gradle': 'dependencies {\n    implementation "org.example:lib:$v"\n    implementation \'org.example:other:1.0\'\n}',
      },
      deps: [dep('implementation', 'org.example:lib:1.0'), dep('implementation', 'org.example:other:1.0')],
    });
    writeFileSync(join(root, 'app/build.gradle'), 'dependencies {\n    implementation "org.example:lib:$v"\n}');
    await expect(updater.applyUpdates(module, root, result.candidates, noop)).rejects.toBeInstanceOf(InstallError);
    expect(read(root, 'gradle.properties')).toBe('v=1.0');
  });
});

describe('refreshing the locks (GRDUPD-06 to GRDUPD-13)', () => {
  it('GRDUPD-06 All lock files of the build are refreshed for the updated coordinate', async () => {
    const { root, module, update } = await prepare(LOCKED);
    const outcome = await updater.applyUpdates(module, root, [update], noop);
    expect(gradle.fake.runs.map((run) => run.cwd)).toEqual([root, root]);
    expect(gradle.fake.describeRuns).toHaveLength(1);
    const [refresh] = gradle.fake.refreshRuns;
    expect(refresh!.args).toEqual([
      '-q', '--console=plain', '--no-configuration-cache', ':app:dependencies', ':core:dependencies', '--update-locks', 'org.example:lib',
    ]);
    expect(refresh!.timeoutMs).toBe(10 * 60_000);
    expect(outcome.auditMessage).toBe('Updated 1 version declaration(s) in 1 file(s). Refreshed 2 dependency lock file(s).');
    expect(read(root, 'app/gradle.lockfile')).toContain('lib:1.1');
  });

  it('GRDUPD-07 Several coordinates are sorted and joined with commas', async () => {
    const { root, module, result } = await prepare({
      ...LOCKED,
      files: { 'app/build.gradle': "dependencies {\n    implementation 'org.example:zeta:1.0'\n    implementation 'org.example:lib:1.0'\n}" },
      deps: [dep('implementation', 'org.example:zeta:1.0'), dep('implementation', 'org.example:lib:1.0')],
    });
    expect(result.candidates).toHaveLength(2);
    await updater.applyUpdates(module, root, result.candidates, noop);
    expect(gradle.fake.refreshRuns[0]!.args.slice(-2)).toEqual(['--update-locks', 'org.example:lib,org.example:zeta']);
  });

  it('GRDUPD-08 Updating only plugins refreshes nothing', async () => {
    const { root, module, update } = await prepare(LOCKED);
    await updater.applyUpdates(module, root, [{ ...update, scope: 'plugin' }], noop);
    expect(gradle.fake.refreshRuns).toEqual([]);
    expect(gradle.fake.runs.every((run) => run.args.includes('-Delevate.mode=describe'))).toBe(true);
  });

  it('GRDUPD-09 A lock file in the root project is addressed as the root task', async () => {
    const { root, module, update } = await prepare({ ...LOCKED, rootExtras: { lockfile: true }, locks: ['.', 'app', 'core'] });
    await updater.applyUpdates(module, root, [update], noop);
    expect(gradle.fake.refreshRuns[0]!.args.slice(3, 6)).toEqual([':dependencies', ':app:dependencies', ':core:dependencies']);
  });

  it('GRDUPD-10 A failed refresh fails the update with Gradle\'s words, and everything is restored', async () => {
    const prepared = await prepare(LOCKED);
    const before = ['app/build.gradle', 'app/gradle.lockfile', 'core/gradle.lockfile'].map((f) => read(prepared.root, f));
    gradle.fake.refresh = () => ({
      exitCode: 1,
      stderr: [
        'FAILURE: Build failed with an exception.', '', '* What went wrong:',
        "Execution failed for task ':app:dependencies'.",
        "> Could not resolve all dependencies for configuration ':app:compileClasspath'.", '', '* Try:',
        '> Run with --stacktrace option to get the stack trace.',
      ].join('\n'),
    });
    const summary = await workflow(prepared);
    expect(summary.rolledBack).toBe(true);
    expect(summary.failure).toBe(
      [
        'Refreshing the Gradle dependency locks failed', 'FAILURE: Build failed with an exception.', '', '* What went wrong:',
        "Execution failed for task ':app:dependencies'.",
        "> Could not resolve all dependencies for configuration ':app:compileClasspath'.",
      ].join('\n'),
    );
    expect(['app/build.gradle', 'app/gradle.lockfile', 'core/gradle.lockfile'].map((f) => read(prepared.root, f))).toEqual(before);
  });

  it('GRDUPD-11 A refresh that does not finish is stopped and named', async () => {
    const prepared = await prepare(LOCKED);
    gradle.fake.refresh = () => ({ exitCode: 1, timedOut: true });
    const summary = await workflow(prepared);
    expect(summary.rolledBack).toBe(true);
    expect(summary.failure).toMatch(/^Refreshing the Gradle dependency locks timed out/);
  });

  describe('included builds', () => {
    /** The module `:build-logic` of an included build, with a candidate in its build script. */
    async function includedModule(withLock: boolean) {
      const prepared = await prepare({
        files: { 'build-logic/build.gradle': "dependencies { implementation 'org.example:lib:1.0' }" },
      });
      const dir = join(prepared.root, 'build-logic');
      if (withLock) writeFileSync(join(dir, 'gradle.lockfile'), LOCK);
      const file = join(dir, 'build.gradle');
      const start = readFileSync(file, 'utf8').indexOf('1.0');
      const candidate: UpdateCandidate = {
        ...prepared.update,
        declaration: undefined,
        declarations: [
          {
            file, kind: 'dependency', displayPath: 'build-logic/build.gradle',
            range: { start, end: start + 3, before: ':', after: "'", text: '1.0' },
          },
        ],
      };
      const module: ProjectModule = {
        id: ':build-logic', name: 'build-logic', path: dir, relPath: 'build-logic', ecosystem: 'gradle', isRoot: false,
        buildDir: prepared.root, buildRoot: dir, buildKind: 'included',
      };
      return { ...prepared, module, candidate, file };
    }

    it('GRDUPD-12 Lock files of an included build are not refreshed, so such an update is refused', async () => {
      const { root, module, candidate, file } = await includedModule(true);
      const original = readFileSync(file, 'utf8');
      const error = await updater.applyUpdates(module, root, [candidate], noop).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InstallError);
      expect((error as Error).message).toBe(
        'The build of module :build-logic (build-logic) uses dependency locking (build-logic/gradle.lockfile), which Elevate refreshes only for the root build. Nothing was changed.',
      );
      expect(readFileSync(file, 'utf8')).toBe(original);
      expect(gradle.fake.runs).toEqual([]);
    });

    it('GRDUPD-13 An included build without lock files is updated like any module', async () => {
      const { root, module, candidate, file } = await includedModule(false);
      await updater.applyUpdates(module, root, [candidate], noop);
      expect(readFileSync(file, 'utf8')).toContain('lib:1.1');
      expect(gradle.fake.refreshRuns).toEqual([]);
    });
  });
});

/** The build of scenario GRDUPD-15: `:app` depends on `:core`; `:docs` only assembles; `:platform` has no task. */
function tasksBuild(root: string) {
  const at = (path: string, tasks: string[], deps: string[] = []) =>
    projectDoc(path, path === ':' ? root : join(root, path.slice(1)), {
      tasks,
      buildFile: join(path === ':' ? root : join(root, path.slice(1)), 'build.gradle'),
      projectDependencies: deps.map((d) => ({ configuration: 'implementation', path: d })),
    });
  return [
    buildDoc('mono', root, [
      at(':', []), at(':app', TASKS, [':core']), at(':core', TASKS), at(':docs', ['assemble']), at(':platform', []),
    ]),
  ];
}

const moduleAt = (root: string, path: string): ProjectModule => ({
  id: path, name: path.slice(1), path: join(root, path.slice(1)), relPath: path.slice(1), ecosystem: 'gradle', isRoot: false,
  buildDir: root, buildRoot: root, buildKind: 'root',
});

describe('the default verification chooses the tasks (GRDUPD-15 to GRDUPD-18)', () => {
  const root = '/work/mono';
  const plan = (files: string[], path = ':core') =>
    planGradleBuild(moduleAt(root, path), tasksBuild(root), files.map((f) => join(root, f)));

  it.each([
    [['core/build.gradle'], ':app:testClasses :core:testClasses'],
    [['app/build.gradle'], ':app:testClasses'],
    [['docs/build.gradle'], ':docs:assemble'],
    [['platform/build.gradle'], 'help'],
    [['gradle.properties'], 'testClasses :docs:assemble'],
    [['gradle/libs.versions.toml'], 'testClasses :docs:assemble'],
    [['build.gradle'], 'testClasses :docs:assemble'],
    [['core/build.gradle', 'app/build.gradle'], ':app:testClasses :core:testClasses'],
    [['core/gradle.lockfile'], ':app:testClasses :core:testClasses'],
  ])('GRDUPD-15 The tasks follow the affected projects: %j', (files, tasks) => {
    expect(plan(files)).toEqual({ tasks: tasks.split(' '), label: `Gradle build (${tasks})` });
  });

  it('GRDUPD-16 Without changed files the module and its dependents are checked', () => {
    expect(plan([]).tasks).toEqual([':app:testClasses', ':core:testClasses']);
  });

  it('GRDUPD-17 A module of an included build is addressed through its build', () => {
    const included = '/work/mono/build-logic';
    const documents = [
      ...tasksBuild(root),
      buildDoc(
        'build-logic',
        included,
        [
          projectDoc(':', included, { tasks: TASKS }),
          projectDoc(':conv', join(included, 'conv'), { tasks: TASKS }),
        ],
        { kind: 'included' },
      ),
    ];
    const module: ProjectModule = {
      id: ':build-logic:conv', name: 'conv', path: join(included, 'conv'), relPath: 'build-logic/conv', ecosystem: 'gradle',
      isRoot: false, buildDir: root, buildRoot: included, buildKind: 'included',
    };
    expect(planGradleBuild(module, documents, []).tasks).toEqual([':build-logic:conv:testClasses']);
    // A change anywhere in the included build affects all its projects, always addressed through its name.
    expect(planGradleBuild(module, documents, [join(included, 'build.gradle')]).tasks).toEqual([
      ':build-logic:conv:testClasses',
      ':build-logic:testClasses',
    ].sort());
  });

  it('GRDUPD-18 A change in buildSrc is verified by configuring and compiling the build', () => {
    const buildSrc = '/work/mono/buildSrc';
    const documents = [...tasksBuild(root), buildDoc('buildSrc', buildSrc, [projectDoc(':', buildSrc, { tasks: TASKS })], { kind: 'buildSrc' })];
    const module: ProjectModule = {
      id: ':buildSrc', name: 'buildSrc', path: buildSrc, relPath: 'buildSrc', ecosystem: 'gradle', isRoot: false,
      buildDir: root, buildRoot: buildSrc, buildKind: 'buildSrc',
    };
    expect(planGradleBuild(module, documents, [])).toEqual({ tasks: ['help'], label: 'Gradle build (help)' });
  });
});

describe('the default verification runs the build (GRDUPD-18 to GRDUPD-25)', () => {
  const verifier = new GradleVerificationAdapter();
  const failing = (stderr: string) => ({ exitCode: 1, stderr });

  it('GRDUPD-18 buildSrc: only the configuration is checked', async () => {
    const { root } = await prepare();
    const buildSrc = join(root, 'buildSrc');
    gradle.fake.documents = [...gradle.fake.documents as never[], buildDoc('buildSrc', buildSrc, [projectDoc(':', buildSrc)], { kind: 'buildSrc' })];
    const module: ProjectModule = {
      id: ':buildSrc', name: 'buildSrc', path: buildSrc, relPath: 'buildSrc', ecosystem: 'gradle', isRoot: false,
      buildDir: root, buildRoot: buildSrc, buildKind: 'buildSrc',
    };
    const result = await verifier.verify(module, root, {});
    expect(gradle.fake.verificationRuns[0]!.args).toEqual(['-q', '--console=plain', 'help']);
    expect(result.details).toBe('Only the configuration of the build and buildSrc were checked: no project with a compile task is affected.');
  });

  it('GRDUPD-19 The run starts in the build directory and has a long timeout', async () => {
    const { root, module } = await prepare();
    await verifier.verify(module, root, {});
    expect(gradle.fake.runs.map((run) => (run.args.includes('-Delevate.mode=describe') ? 'describe' : 'verify'))).toEqual(['describe', 'verify']);
    expect(gradle.fake.verificationRuns[0]).toMatchObject({ cwd: root, timeoutMs: 30 * 60_000 });
  });

  it('GRDUPD-20 A successful build is clean', async () => {
    const { root, module } = await prepare();
    expect(await verifier.verify(module, root, {})).toEqual({
      status: 'clean',
      details: 'All affected projects build successfully.',
      label: 'Gradle build (:app:testClasses)',
    });
  });

  it('GRDUPD-21 A failed build is a warning that quotes Gradle', async () => {
    const { root, module } = await prepare();
    gradle.fake.verifications = [
      failing(
        [
          '/work/app/src/main/java/demo/App.java:2: error: cannot find symbol', '  symbol:   method greet()', '  location: class Lib', '1 error', '',
          'FAILURE: Build failed with an exception.', '', '* What went wrong:', "Execution failed for task ':app:compileJava'.",
          '> Compilation failed; see the compiler error output for details.', '', '* Try:', '> Run with --stacktrace option to get the stack trace.',
        ].join('\n'),
      ),
    ];
    const result = await verifier.verify(module, root, {});
    expect(result.status).toBe('warn');
    expect(result.details).toContain('error: cannot find symbol');
    expect(result.details).toContain("Execution failed for task ':app:compileJava'.");
    expect(result.details).not.toContain('Run with --stacktrace');
  });

  it('GRDUPD-21 A build that cannot be described stops the verification there', async () => {
    const { root, module } = await prepare();
    gradle.fake.describeQueue = [
      failing(
        [
          'FAILURE: Build failed with an exception.', '', '* What went wrong:', "A problem occurred configuring root project 'mono'.",
          "> Could not resolve all artifacts for configuration 'classpath'.",
          "   > Could not resolve org.example:plug:1.1.",
          "      > Cannot find a version of 'org.example:plug' that satisfies the version constraints:",
          "         Constraint path ':mono:1.0.0' --> 'org.example:plug:{strictly 1.0}' because of the following reason: Dependency version enforced by Dependency Locking",
          '', '* Try:', '> Run with --stacktrace option to get the stack trace.',
        ].join('\n'),
      ),
    ];
    const result = await verifier.verify(module, root, {});
    expect(result).toMatchObject({ status: 'warn', label: 'Gradle build' });
    expect(result.details).toContain('Dependency version enforced by Dependency Locking');
    expect(gradle.fake.verificationRuns).toEqual([]);
  });

  it('GRDUPD-22 A build that does not finish is a warning', async () => {
    const { root, module } = await prepare();
    gradle.fake.verifications = [{ exitCode: 1, timedOut: true }];
    expect(await verifier.verify(module, root, {})).toMatchObject({ status: 'warn', details: 'Gradle build timed out.' });
  });

  it('GRDUPD-23 Gradle that cannot be started is a warning, not a crash', async () => {
    const { root, module } = await prepare();
    // The scan has already checked `gradle --version` once; this process starts afresh.
    resetGradleCheck();
    gradle.fake.versionBehaviour = 'missing';
    expect(await verifier.verify(module, root, {})).toMatchObject({
      status: 'warn',
      details: 'Gradle is not available: no Gradle Wrapper (gradlew) in the repository and no `gradle` on the PATH.',
    });
  });

  it.runIf(process.platform !== 'win32')('GRDUPD-24 A custom script replaces the default and runs in the build directory', async () => {
    const { root, module } = await prepare();
    const result = await verifier.verify(module, root, { customScript: 'test "$(pwd -P)" = "$(cd "' + root + '" && pwd -P)"', customLabel: 'Full check' });
    expect(result).toEqual({ status: 'clean', details: 'Verification script succeeded.', label: 'Full check' });
    expect(gradle.fake.runs).toEqual([]);
  });

  it.runIf(process.platform !== 'win32')('GRDUPD-25 A failing custom script is a warning with Gradle\'s error lines', async () => {
    const { root, module } = await prepare();
    const result = await verifier.verify(module, root, {
      customScript: 'echo "FAILURE: Build failed with an exception." 1>&2; exit 1',
      customLabel: 'Full check',
    });
    expect(result.status).toBe('warn');
    expect(result.details).toContain('FAILURE: Build failed with an exception.');
  });
});

describe('the whole update is undone when a step fails (GRDUPD-26 to GRDUPD-32, GRDUPD-43, GRDUPD-44)', () => {
  const compileError = { exitCode: 1, stderr: 'error: cannot find symbol' };

  it('GRDUPD-26 A compile error after the update restores the files', async () => {
    const prepared = await prepare();
    const original = read(prepared.root, 'app/build.gradle');
    gradle.fake.verifications = [{}, compileError];
    const summary = await workflow(prepared);
    expect(summary).toMatchObject({ rolledBack: true, failure: 'Verification failed: Gradle build (:app:testClasses)', updatedCount: 0, changedFiles: [] });
    expect(read(prepared.root, 'app/build.gradle')).toBe(original);
    expect(gradle.fake.runs.at(-1)!.args).toContain(':app:testClasses');
  });

  it('GRDUPD-27 Dependency verification protects the build and the update is rolled back', async () => {
    const prepared = await prepare({
      files: { 'gradle/verification-metadata.xml': '<verification-metadata><configuration><verify-metadata>true</verify-metadata></configuration></verification-metadata>' },
    });
    const metadata = read(prepared.root, 'gradle/verification-metadata.xml');
    gradle.fake.verifications = [
      {},
      {
        exitCode: 1,
        stderr: [
          'FAILURE: Build failed with an exception.', '', '* What went wrong:', "Execution failed for task ':app:compileJava'.",
          "> Dependency verification failed for configuration ':app:compileClasspath'", '  2 artifacts failed verification:',
          '    - lib-1.1.jar (org.example:lib:1.1) from repository acme',
        ].join('\n'),
      },
    ];
    const summary = await workflow(prepared);
    expect(summary.rolledBack).toBe(true);
    expect(summary.verificationDetails).toContain("Dependency verification failed for configuration ':app:compileClasspath'");
    expect(read(prepared.root, 'gradle/verification-metadata.xml')).toBe(metadata);
    expect(shown(prepared.root, updater.affectedFiles(prepared.module, prepared.root, [prepared.update]))).not.toContain('gradle/verification-metadata.xml');
    expect(gradle.fake.runs.some((run) => run.args.includes('--write-verification-metadata'))).toBe(false);
  });

  it('GRDUPD-28 A build that already failed before the update does not stop it', async () => {
    const prepared = await prepare();
    gradle.fake.verifications = [compileError, compileError];
    const summary = await workflow(prepared);
    expect(summary.rolledBack).toBeUndefined();
    expect(summary.verificationDetails).toMatch(/^Verification already failed before the update; the update was kept\./);
  });

  it('GRDUPD-29 Keeping the changes of a failed verification keeps the refreshed locks too', async () => {
    const prepared = await prepare(LOCKED);
    gradle.fake.verifications = [{}, compileError];
    const summary = await workflow(prepared, { keepOnFailure: true });
    expect(summary.rolledBack).toBeUndefined();
    expect(summary.verificationStatus).toBe('warn');
    expect(summary.changedFiles).toEqual(expect.arrayContaining(['app/build.gradle', 'app/gradle.lockfile', 'core/gradle.lockfile']));
  });

  it('GRDUPD-30 Skipping the verification still refreshes the locks and runs no build', async () => {
    const prepared = await prepare(LOCKED);
    const summary = await workflow(prepared, { skipVerification: true });
    expect(gradle.fake.runs.map((run) => (run.args.includes('--update-locks') ? 'refresh' : run.args.includes('-Delevate.mode=describe') ? 'describe' : 'verify'))).toEqual(['describe', 'refresh']);
    expect(summary.verificationStatus).toBeUndefined();
  });

  it('GRDUPD-32 The verification before and after the update names the same tasks', async () => {
    const prepared = await prepare();
    await workflow(prepared);
    const kinds = gradle.fake.runs.map((run) => (run.args.includes('-Delevate.mode=describe') ? 'describe' : 'verify'));
    expect(kinds).toEqual(['describe', 'verify', 'describe', 'verify']);
    const [before, after] = gradle.fake.verificationRuns;
    expect(before!.args).toEqual(after!.args);
  });

  it.runIf(process.platform !== 'win32')('GRDUPD-43 The directory the repository lives in never appears on the command lines', async () => {
    const prepared = await prepare({ ...LOCKED, dir: 'R&D' });
    const summary = await workflow(prepared);
    expect(summary.rolledBack).toBeUndefined();
    expect(gradle.fake.runs.length).toBeGreaterThan(3);
    for (const run of gradle.fake.runs) {
      expect(run.cwd).toBe(prepared.root);
      expect([run.command, ...run.args].some((arg) => arg.includes('R&D'))).toBe(false);
    }
  });

  it('GRDUPD-44 A project path the Windows shell would interpret is refused with an explanation', async () => {
    const prepared = await prepare({
      ...LOCKED,
      projects: (root) => [projectDoc(':a&b', join(root, 'a&b'), { tasks: TASKS, lockfile: true })],
    });
    gradle.fake.windows = true;
    const summary = await workflow(prepared, { skipVerification: true });
    expect(summary.rolledBack).toBe(true);
    expect(summary.failure).toContain('Cannot pass ":a&b:dependencies" to the Windows command shell');
    expect(gradle.fake.runs.every((run) => run.args.includes('-Delevate.mode=describe'))).toBe(true);
  });
});

describe('requested updates are checked against what the repositories reported (GRDUPD-33 to GRDUPD-37)', () => {
  const options = { ecosystem: 'gradle' as const, allowMajor: false, originOf: () => 'public' as const };
  const request = (scanResult: ScanResult, identifier: string, targetVersion?: string) =>
    () => selectRequested(scanResult, [{ identifier, targetVersion }], options);

  it('GRDUPD-33 A version chosen by hand must exist in the repositories', async () => {
    const { result } = await prepare({ lookups: { 'org.example:lib': { versions: ['1.0', '1.1', '1.2'] } } });
    expect(request(result, 'org.example:lib', '9.9.9')).toThrow(UpdateSelectionError);
    expect(request(result, 'org.example:lib', '9.9.9')).toThrow(
      "'org.example:lib' has no version 9.9.9 in the configured repositories. Available: 1.2, 1.1, 1.0.",
    );
  });

  it('GRDUPD-34 A dependency without a pending update cannot be retargeted', async () => {
    const { result } = await prepare();
    expect(request(result, 'org.example:unknown', '1.2.3')).toThrow(
      "'org.example:unknown' has no pending update. Updates are written where the scan located the version; a dependency without an offered update cannot be retargeted.",
    );
  });

  it('GRDUPD-35 A dependency that was listed as not offered says why', async () => {
    const { result } = await prepare({
      files: { 'app/build.gradle': "dependencies { implementation 'org.example:lib:1.+' }" },
      deps: [dep('implementation', 'org.example:lib:1.+')],
    });
    expect(request(result, 'org.example:lib')).toThrow(
      "'org.example:lib' cannot be updated: version is a selector or constraint, not a plain version (dynamic version '1.+').",
    );
  });

  it('GRDUPD-36 A module of an included build can only be aligned to its local version', async () => {
    const { update } = await prepare();
    const align: UpdateCandidate = { ...update, action: 'align', latest: '2.0.0', newRange: '2.0.0', origin: { kind: 'workspace', moduleId: ':lib', moduleRelPath: 'lib' } };
    expect(request({ candidates: [align], skipped: [] }, 'org.example:lib', '3.0.0')).toThrow(
      "'org.example:lib' is a workspace module; it can only be aligned to its local version 2.0.0.",
    );
  });

  it('GRDUPD-37 A major update needs the explicit permission', async () => {
    const { result } = await prepare({ lookups: { 'org.example:lib': { versions: ['1.0', '2.0'] } } });
    expect(request(result, 'org.example:lib')).toThrow("'org.example:lib' is a major update (1.0.0 ➔ 2.0). Pass --allow-major / allowMajor.");
  });
});
