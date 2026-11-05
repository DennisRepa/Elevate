import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupTemp, makeTree } from '../helpers.js';

const probe = vi.hoisted(() => ({ runDescribe: vi.fn() }));
vi.mock('../../src/adapters/gradle/gradle-probe.js', () => probe);

import { GradleModuleDiscoveryAdapter, findGradleBuildDirs } from '../../src/adapters/gradle/gradle-discovery.js';
import type { GradleBuildDocument } from '../../src/adapters/gradle/gradle-probe.js';

afterEach(cleanupTemp);
beforeEach(() => probe.runDescribe.mockReset());

const adapter = new GradleModuleDiscoveryAdapter();
const rel = (root: string, dirs: (string | undefined)[]): (string | undefined)[] =>
  dirs.map((dir) => (dir === undefined ? undefined : dir === root ? '.' : dir.slice(root.length + 1).replace(/\\/g, '/')));

describe('Gradle repository root (GRD-08 to GRD-17)', () => {
  it('GRD-08 A subproject resolves to the root of its build', () => {
    const root = makeTree({ 'settings.gradle': "include 'app', 'lib'", 'app/build.gradle': '', 'lib/build.gradle': '' });
    expect(adapter.findRoot(join(root, 'app'), undefined)).toBe(root);
  });

  it('GRD-09 The Kotlin DSL settings file counts too', () => {
    const root = makeTree({ 'settings.gradle.kts': 'include("app")', 'app/build.gradle.kts': '' });
    expect(adapter.findRoot(join(root, 'app'), undefined)).toBe(root);
  });

  it('GRD-10 A nested build with its own settings file is its own root', () => {
    const root = makeTree({
      'settings.gradle': "include 'app'",
      'app/build.gradle': '',
      'tools/settings.gradle': "rootProject.name = 'tools'",
      'tools/build.gradle': '',
    });
    expect(adapter.findRoot(join(root, 'tools'), undefined)).toBe(join(root, 'tools'));
  });

  it.each([
    ["include 'app'; includeBuild 'build-logic'", true],
    ['include("app"); includeBuild("build-logic")', true],
    ["include 'app'; includeBuild('./build-logic')", true],
    ['pluginManagement { includeBuild("build-logic") }', true],
    ['include \'app\'; includeBuild(file("build-logic"))', false],
    ["def n = 'build-logic'; includeBuild(n)", false],
    ['include \'app\'; includeBuild("build-" + "logic")', false],
    ['include \'app\'; // includeBuild("build-logic")', false],
    ["include 'app'; /* includeBuild('build-logic') */", false],
    ["include 'app'", false],
  ])('GRD-11 An included build resolves to the including build: %s', (settings, includes) => {
    const root = makeTree({
      'settings.gradle': settings,
      'app/build.gradle': '',
      'build-logic/settings.gradle': "rootProject.name = 'build-logic'",
      'build-logic/build.gradle': '',
    });
    expect(adapter.findRoot(join(root, 'build-logic'), undefined)).toBe(includes ? root : join(root, 'build-logic'));
  });

  it('GRD-12 Chains of included builds are climbed to the outermost', () => {
    const root = makeTree({
      'settings.gradle': "includeBuild 'platform'",
      'platform/settings.gradle': "includeBuild 'conventions'",
      'platform/conventions/settings.gradle': "rootProject.name = 'conventions'",
    });
    expect(adapter.findRoot(join(root, 'platform/conventions'), undefined)).toBe(root);
  });

  it('GRD-13 The buildSrc directory belongs to the build around it', () => {
    const root = makeTree({
      'settings.gradle': "include 'app'",
      'app/build.gradle': '',
      'buildSrc/settings.gradle': "rootProject.name = 'buildSrc'",
      'buildSrc/build.gradle': '',
      'buildSrc/src/main/groovy/.keep': '',
    });
    expect(adapter.findRoot(join(root, 'buildSrc/src/main'), undefined)).toBe(root);
  });

  it('GRD-14 A build script without any settings file is its own root', () => {
    const root = makeTree({ 'build.gradle': '', 'sample/build.gradle': '' });
    expect(adapter.findRoot(join(root, 'sample'), root)).toBe(join(root, 'sample'));
  });

  it('GRD-15 Settings files above the checkout are ignored', () => {
    const root = makeTree({
      'settings.gradle': "include 'checkout:app'",
      'checkout/.git/HEAD': '',
      'checkout/app/build.gradle': '',
    });
    const checkout = join(root, 'checkout');
    expect(adapter.findRoot(join(checkout, 'app'), checkout)).toBe(join(checkout, 'app'));
  });

  it('GRD-17 A directory without Gradle markers gets no Gradle proposal', () => {
    const root = makeTree({ 'docs/readme.md': '' });
    expect(adapter.findRoot(join(root, 'docs'), root)).toBeUndefined();
  });
});

describe('Gradle build directories (GRD-18 to GRD-26)', () => {
  it('GRD-18 A multi-project build is one build directory', () => {
    const root = makeTree({ 'settings.gradle': "include 'app', 'lib'", 'app/build.gradle': '', 'lib/build.gradle': '' });
    expect(rel(root, findGradleBuildDirs(root))).toEqual(['.']);
    expect(probe.runDescribe).not.toHaveBeenCalled();
  });

  it('GRD-19 Independent builds without a common settings file are separate', () => {
    const root = makeTree({
      'services/billing/settings.gradle': "rootProject.name = 'billing'",
      'services/shipping/settings.gradle.kts': 'rootProject.name = "shipping"',
    });
    expect(rel(root, findGradleBuildDirs(root))).toEqual(['services/billing', 'services/shipping']);
  });

  it('GRD-20 A lone build script without settings is a build directory', () => {
    const root = makeTree({ 'tool/build.gradle.kts': 'plugins { java }' });
    expect(rel(root, findGradleBuildDirs(root))).toEqual(['tool']);
  });

  it('GRD-21 Fixture and sample builds inside a source tree are not builds', () => {
    const root = makeTree({
      'settings.gradle': "include 'plugin'",
      'plugin/build.gradle': '',
      'plugin/src/functionalTest/fixtures/sample/settings.gradle': "rootProject.name = 'sample'",
    });
    expect(rel(root, findGradleBuildDirs(root))).toEqual(['.']);
  });

  it.each(['node_modules', 'build', 'target', 'dist', 'out', '.gradle', '.git'])(
    'GRD-22 %s is not walked',
    (directory) => {
      const root = makeTree({
        'settings.gradle': "rootProject.name = 'app'",
        [`${directory}/leftover/settings.gradle`]: "rootProject.name = 'leftover'",
      });
      expect(rel(root, findGradleBuildDirs(root))).toEqual(['.']);
    },
  );

  it('GRD-23 A directory named src that is not a project source tree is walked', () => {
    const root = makeTree({ 'src/backend/settings.gradle': "rootProject.name = 'backend'" });
    expect(rel(root, findGradleBuildDirs(root))).toEqual(['src/backend']);
  });

  it('GRD-26 buildSrc is not found by the walk', () => {
    const root = makeTree({ 'settings.gradle': "include 'app'", 'buildSrc/build.gradle': '' });
    expect(rel(root, findGradleBuildDirs(root))).toEqual(['.']);
  });
});

function project(path: string, dir: string, buildFile: string | null, group: string | null = null, version: string | null = null) {
  return {
    path, name: path === ':' ? 'root' : path.split(':').pop()!, dir, buildFile, group, version,
    repositories: [], buildscriptRepositories: [], dependencies: [], constraints: [],
    projectDependencies: [], buildscriptDependencies: [], tasks: [], lockfile: false,
  };
}

function build(name: string, dir: string, kind: 'root' | 'included' | 'buildSrc', projects: ReturnType<typeof project>[]): GradleBuildDocument {
  return {
    protocol: 1, mode: 'describe', gradleVersion: '8.14.3',
    build: { name, kind, dir, repositoriesMode: null, settingsRepositories: [], pluginRepositories: [], settingsPlugins: [] },
    projects,
  };
}

describe('Gradle modules (GRD-24 to GRD-34)', () => {
  it('GRD-27 Projects with a build script are modules; the others are not', async () => {
    const root = makeTree({ 'settings.gradle': 'x' });
    probe.runDescribe.mockResolvedValue([
      build('mono', root, 'root', [
        project(':', root, join(root, 'build.gradle'), 'com.acme', '1.0.0'),
        project(':app', join(root, 'app'), join(root, 'app/build.gradle'), 'com.acme', '1.0.0'),
        project(':libs', join(root, 'libs'), null, 'com.acme', '1.0.0'),
        project(':libs:core', join(root, 'libs/core'), join(root, 'libs/core/build.gradle.kts'), 'com.acme', '1.0.0'),
      ]),
    ]);
    const modules = await adapter.discover(root);
    expect(modules.map((m) => [m.id, m.name, m.relPath, m.isRoot, m.version, m.buildKind, m.coordinates])).toEqual([
      [':', 'mono', 'Root', true, '1.0.0', 'root', 'com.acme:root'],
      [':app', 'app', 'app', false, '1.0.0', 'root', 'com.acme:app'],
      [':libs:core', 'core', 'libs/core', false, '1.0.0', 'root', 'com.acme:core'],
    ]);
    expect(modules.every((m) => m.ecosystem === 'gradle')).toBe(true);
  });

  it('GRD-29 The root project is a module even without a build script', async () => {
    const root = makeTree({ 'settings.gradle': 'x' });
    probe.runDescribe.mockResolvedValue([build('mono', root, 'root', [project(':', root, null, null, 'unspecified')])]);
    const modules = await adapter.discover(root);
    expect(modules).toHaveLength(1);
    expect(modules[0]).toMatchObject({ id: ':', name: 'mono', relPath: 'Root', version: undefined, coordinates: undefined });
  });

  it('GRD-31 Included builds and buildSrc contribute their projects', async () => {
    const root = makeTree({ 'settings.gradle': 'x' });
    probe.runDescribe.mockResolvedValue([
      build('mono', root, 'root', [project(':', root, join(root, 'build.gradle'), 'com.acme', '1.0.0')]),
      build('build-logic', join(root, 'build-logic'), 'included', [
        project(':', join(root, 'build-logic'), join(root, 'build-logic/build.gradle.kts'), 'com.acme.logic', '0.5.0'),
      ]),
      build('buildSrc', join(root, 'buildSrc'), 'buildSrc', [
        project(':', join(root, 'buildSrc'), join(root, 'buildSrc/build.gradle'), null, 'unspecified'),
      ]),
    ]);
    const modules = await adapter.discover(root);
    expect(modules.map((m) => [m.id, m.relPath, m.buildKind, m.buildDir, m.buildRoot, m.coordinates])).toEqual([
      [':', 'Root', 'root', root, root, 'com.acme:root'],
      [':build-logic', 'build-logic', 'included', root, join(root, 'build-logic'), 'com.acme.logic:root'],
      [':buildSrc', 'buildSrc', 'buildSrc', root, join(root, 'buildSrc'), undefined],
    ]);
  });

  it('GRD-32 An included build outside the repository is not a module', async () => {
    const parent = makeTree({ 'repo/settings.gradle': 'x', 'ext-lib/build.gradle': '' });
    const root = join(parent, 'repo');
    probe.runDescribe.mockResolvedValue([
      build('mono', root, 'root', [project(':', root, join(root, 'build.gradle'))]),
      build('ext-lib', join(parent, 'ext-lib'), 'included', [project(':', join(parent, 'ext-lib'), join(parent, 'ext-lib/build.gradle'))]),
    ]);
    expect((await adapter.discover(root)).map((m) => m.id)).toEqual([':']);
  });

  it('GRD-24 A build that an outer build includes is described once', async () => {
    const root = makeTree({ 'settings.gradle': "includeBuild 'tools'", 'tools/settings.gradle': "rootProject.name = 'tools'" });
    probe.runDescribe.mockResolvedValue([
      build('root', root, 'root', [project(':', root, null)]),
      build('tools', join(root, 'tools'), 'included', [project(':', join(root, 'tools'), join(root, 'tools/build.gradle'))]),
    ]);
    const modules = await adapter.discover(root);
    expect(probe.runDescribe).toHaveBeenCalledTimes(1);
    expect(probe.runDescribe).toHaveBeenCalledWith(root, root);
    expect(modules.map((m) => m.id)).toEqual([':', ':tools']);
  });

  it('GRD-25 A nested build that no outer build includes is described in its own run', async () => {
    const root = makeTree({
      'settings.gradle': "include 'app'",
      'app/build.gradle': '',
      'examples/demo/settings.gradle': "rootProject.name = 'demo'",
      'examples/demo/build.gradle': '',
    });
    const demo = join(root, 'examples/demo');
    probe.runDescribe.mockImplementation(async (dir: string) =>
      dir === root
        ? [build('root', root, 'root', [project(':', root, null), project(':app', join(root, 'app'), join(root, 'app/build.gradle'))])]
        : [build('demo', demo, 'root', [project(':', demo, join(demo, 'build.gradle'))])],
    );
    const modules = await adapter.discover(root);
    expect(probe.runDescribe.mock.calls.map((c) => c[0])).toEqual([root, demo]);
    expect(modules.map((m) => m.id)).toEqual([':', ':app', ':demo']);
  });

  it('GRD-34 A repository without a Gradle build has no modules and starts no process', async () => {
    const root = makeTree({ 'pom.xml': '<project/>' });
    expect(await adapter.discover(root)).toEqual([]);
    expect(probe.runDescribe).not.toHaveBeenCalled();
  });
});
