import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeGradle, buildDoc, dep, projectDoc, repo } from '../gradle-fake.js';
import { USUAL_SCRIPT, candidate, plannedLookups, scan } from '../gradle-scan.js';
import type { Scenario } from '../gradle-scan.js';
import { cleanupTemp } from '../helpers.js';

const gradle = vi.hoisted(() => ({ fake: undefined as unknown as FakeGradle }));
vi.mock('../../src/adapters/shared/process.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/adapters/shared/process.js')>();
  return { ...actual, runCommand: (...args: Parameters<typeof actual.runCommand>) => gradle.fake.runCommand(...args) };
});

import { resetGradleCheck } from '../../src/adapters/gradle/gradle-command.js';

beforeEach(() => {
  gradle.fake = new FakeGradle();
  resetGradleCheck();
});
afterEach(cleanupTemp);

const run = (scenario: Scenario = {}) => scan(gradle.fake, scenario);
const skippedOf = (scanned: Awaited<ReturnType<typeof run>>, identifier: string) =>
  scanned.result.skipped.find((s) => s.identifier === identifier);

describe('what is offered (GRDDEC-01, 04 to 11)', () => {
  it('GRDDEC-01 A dependency in string notation is offered with its location', async () => {
    const scanned = await run();
    expect(scanned.result.candidates).toHaveLength(1);
    expect(candidate(scanned, 'org.example:lib')).toMatchObject({
      currentRange: '1.0', newRange: '1.1', diff: 'minor', action: 'update', origin: { kind: 'public' }, scope: 'prod', selected: true,
      declaration: { kind: 'dependency', displayPath: 'app/build.gradle' },
    });
    expect(candidate(scanned, 'org.example:lib')!.coordinate).toMatchObject({ group: 'org.example', artifact: 'lib', ecosystem: 'gradle' });
  });

  it.each([
    ['implementation', 'prod'], ['api', 'prod'], ['compileOnly', 'prod'], ['runtimeOnly', 'prod'], ['annotationProcessor', 'prod'],
    ['testImplementation', 'test'], ['testRuntimeOnly', 'test'], ['integrationTestImplementation', 'test'],
    ['androidTestImplementation', 'test'], ['testFixturesApi', 'test'],
  ])('GRDDEC-04 The scope follows the configuration %s', async (configuration, scope) => {
    const scanned = await run({
      files: { 'app/build.gradle': `dependencies { ${configuration} 'org.example:lib:1.0' }` },
      deps: [dep(configuration, 'org.example:lib:1.0')],
    });
    expect(candidate(scanned, 'org.example:lib')!.scope).toBe(scope);
  });

  it('GRDDEC-05 Projects, files and dependencies without a version are not subjects and not looked up', async () => {
    const scanned = await run({
      deps: [dep('implementation', 'org.springframework:spring-core')],
      files: { 'app/build.gradle': "dependencies { implementation 'org.springframework:spring-core' }" },
    });
    expect(scanned.result.candidates).toEqual([]);
    expect(scanned.result.skipped).toEqual([]);
    expect(plannedLookups(scanned.fake)).toEqual([]);
  });

  it('GRDDEC-06 A dependency without a group is listed as not offered', async () => {
    const scanned = await run({ deps: [dep('implementation', ':legacy:1.0')] });
    expect(scanned.result.candidates).toEqual([]);
    expect(scanned.result.skipped).toEqual([{ identifier: 'legacy', origin: 'public', reason: 'invalid-name', detail: 'no group' }]);
    expect(plannedLookups(scanned.fake)).toEqual([]);
  });

  it('GRDDEC-07 A coordinate in several configurations is one candidate and every declaration changes', async () => {
    const script = "dependencies {\n    implementation 'org.example:lib:1.0'\n    testImplementation 'org.example:lib:1.0'\n}";
    const scanned = await run({
      files: { 'app/build.gradle': script },
      deps: [dep('implementation', 'org.example:lib:1.0'), dep('testImplementation', 'org.example:lib:1.0')],
    });
    expect(scanned.result.candidates).toHaveLength(1);
    expect(candidate(scanned, 'org.example:lib')).toMatchObject({ scope: 'prod' });
    expect(candidate(scanned, 'org.example:lib')!.declarations).toHaveLength(2);
  });

  it('GRDDEC-08 Declarations with different versions follow the main configuration', async () => {
    const script = "dependencies {\n    testImplementation 'org.example:lib:1.0'\n    implementation 'org.example:lib:1.1'\n}";
    const scanned = await run({
      files: { 'app/build.gradle': script },
      deps: [dep('testImplementation', 'org.example:lib:1.0'), dep('implementation', 'org.example:lib:1.1')],
      lookups: { 'org.example:lib': { versions: ['1.2', '1.1', '1.0'] } },
    });
    expect(scanned.result.candidates).toHaveLength(1);
    const c = candidate(scanned, 'org.example:lib')!;
    expect([c.currentRange, c.newRange, c.scope]).toEqual(['1.1', '1.2', 'prod']);
    const texts = c.declarations!.map((d) => d.range!.text).sort();
    expect(texts).toEqual(['1.0', '1.1']);
  });

  it('GRDDEC-10 A dependency and a constraint are one candidate with two locations', async () => {
    const script = "dependencies {\n    implementation 'org.example:lib:1.0'\n    constraints { implementation 'org.example:lib:1.0' }\n}";
    const scanned = await run({
      files: { 'app/build.gradle': script },
      deps: [dep('implementation', 'org.example:lib:1.0')],
      constraints: [{ configuration: 'implementation', group: 'org.example', name: 'lib', version: '1.0', strictly: null }],
    });
    expect(scanned.result.candidates).toHaveLength(1);
    expect(candidate(scanned, 'org.example:lib')!.declarations!.map((d) => d.kind)).toEqual(['dependency', 'dependency-management']);
  });

  it('GRDDEC-11 Classpath dependencies of a buildscript block are plugin-scoped', async () => {
    const scanned = await run({
      files: { 'app/build.gradle': "buildscript {\n    dependencies { classpath 'org.example:gradle-plugin:1.0' }\n}" },
      deps: [],
      buildscriptDependencies: [{ group: 'org.example', name: 'gradle-plugin', version: '1.0' }],
    });
    expect(candidate(scanned, 'org.example:gradle-plugin')).toMatchObject({ scope: 'plugin', declaration: { kind: 'dependency' } });
  });
});

describe('names and sharing (GRDDEC-13, 18, 20 to 22, 30, 31)', () => {
  const shared = {
    files: {
      'gradle.properties': 'jacksonVersion=1.0',
      'app/build.gradle':
        'dependencies {\n    implementation "org.example:core:$jacksonVersion"\n    implementation "org.example:databind:$jacksonVersion"\n}',
    },
    deps: [dep('implementation', 'org.example:core:1.0'), dep('implementation', 'org.example:databind:1.0')],
  };

  it('GRDDEC-13 A version from gradle.properties is declared as a property', async () => {
    const scanned = await run({
      files: { 'gradle.properties': 'jacksonVersion=1.0', 'app/build.gradle': 'dependencies { implementation "org.example:lib:$jacksonVersion" }' },
    });
    expect(candidate(scanned, 'org.example:lib')!.declaration).toMatchObject({ kind: 'property', propertyName: 'jacksonVersion', displayPath: 'gradle.properties' });
  });

  it('GRDDEC-18 A name shared by several dependencies is shown as shared', async () => {
    const scanned = await run(shared);
    expect(candidate(scanned, 'org.example:core')!.sharedWith).toEqual(['org.example:databind']);
    expect(candidate(scanned, 'org.example:databind')!.sharedWith).toEqual(['org.example:core']);
  });

  it.each([
    [''], ['ext { v = computeVersion() }'], ['ext { v = "1.${minor}" }'], ["def v = '1.' + '0'"],
  ])('GRDDEC-20 A name without a plain definition is listed as not offered, and not asked: %s', async (definition) => {
    const scanned = await run({ files: { 'app/build.gradle': `${definition}\ndependencies { implementation "org.example:lib:$v" }` } });
    expect(scanned.result.candidates).toEqual([]);
    expect(skippedOf(scanned, 'org.example:lib')).toEqual({
      identifier: 'org.example:lib', origin: 'public', reason: 'declaration-mismatch',
      detail: "no definition of 'v' in gradle.properties or in the build scripts of ':app' and its parent projects",
    });
    expect(plannedLookups(scanned.fake)).toEqual([]);
  });

  it('GRDDEC-21 A value that Gradle overrides is not edited', async () => {
    const scanned = await run({
      files: { 'gradle.properties': 'v=0.9', 'app/build.gradle': 'dependencies { implementation "org.example:lib:$v" }' },
    });
    expect(skippedOf(scanned, 'org.example:lib')!.detail).toBe(
      "'v' is 0.9 in gradle.properties but Gradle uses 1.0 (command line or user-level override?)",
    );
  });

  it.each([
    'dependencies { implementation "org.example:lib:${versions.lib}" }',
    'dependencies { implementation "org.example:lib:${project.version}" }',
    'dependencies { implementation "org.example:lib:$v-jre" }',
    'dependencies { implementation "org.example:lib:" + lib() }',
    'dependencies { implementation(libraries.lib) }',
  ])('GRDDEC-30 A version that is computed is listed as not offered: %s', async (line) => {
    const scanned = await run({ files: { 'app/build.gradle': line } });
    expect(skippedOf(scanned, 'org.example:lib')).toMatchObject({
      reason: 'declaration-mismatch',
      detail: 'no declaration of org.example:lib:1.0 found in app/build.gradle or in the build scripts of its parent projects',
    });
    expect(plannedLookups(scanned.fake)).toEqual([]);
  });
});

describe('plugins (GRDDEC-23, 25, 27)', () => {
  const plugin = { group: 'org.example.plugin', name: 'org.example.plugin.gradle.plugin', version: '1.0' };

  it('GRDDEC-23 A plugin is offered as the plugin id with the scope plugin', async () => {
    const scanned = await run({
      files: { 'app/build.gradle': "plugins { id 'org.example.plugin' version '1.0' }" },
      deps: [],
      buildscriptDependencies: [plugin],
      lookups: { 'org.example.plugin:org.example.plugin.gradle.plugin': { versions: ['1.1', '1.0'] } },
    });
    expect(scanned.result.candidates).toHaveLength(1);
    const c = candidate(scanned, 'org.example.plugin')!;
    expect(c).toMatchObject({ scope: 'plugin', newRange: '1.1', declaration: { kind: 'plugin' } });
    expect(c.coordinate).toMatchObject({ group: 'org.example.plugin', artifact: 'org.example.plugin.gradle.plugin' });
  });

  it('GRDDEC-27 Plugins without a version are not subjects', async () => {
    const scanned = await run({
      files: { 'app/build.gradle': "plugins { id 'java'; id 'org.example.versionless' }" },
      deps: [],
    });
    expect(scanned.result.candidates).toEqual([]);
    expect(scanned.result.skipped).toEqual([]);
  });
});

describe('what is not a plain version (GRDDEC-28, 29)', () => {
  it.each(['1.+', '+', '1.0.+', 'latest.release', '[1.0,2.0)'])('GRDDEC-28 %s is listed and not asked', async (version) => {
    const scanned = await run({
      files: { 'app/build.gradle': `dependencies { implementation 'org.example:lib:${version}' }` },
      deps: [dep('implementation', `org.example:lib:${version}`)],
    });
    expect(scanned.result.candidates).toEqual([]);
    expect(scanned.result.skipped).toEqual([
      { identifier: 'org.example:lib', origin: 'public', reason: 'version-constraint', detail: `dynamic version '${version}'` },
    ]);
    expect(plannedLookups(scanned.fake)).toEqual([]);
  });

  it.each([
    [{ strictly: '1.0' }, "strictly '1.0'"],
    [{ rejected: ['1.1'] }, "reject '1.1'"],
    [{ preferred: '1.0' }, "prefer '1.0'"],
  ])('GRDDEC-29 %j is not edited', async (flag, detail) => {
    const scanned = await run({ deps: [dep('implementation', 'org.example:lib:1.0', flag)] });
    expect(scanned.result.candidates).toEqual([]);
    expect(skippedOf(scanned, 'org.example:lib')).toMatchObject({ reason: 'version-constraint', detail });
  });
});

describe('catalogs (GRDCAT-04 to GRDCAT-10)', () => {
  const CATALOG = 'gradle/libs.versions.toml';

  it('GRDCAT-01 A library from the catalog is offered at its version entry', async () => {
    const scanned = await run({
      files: {
        [CATALOG]: '[versions]\nguava = "1.0"\n\n[libraries]\nguava = { module = "org.example:guava", version.ref = "guava" }\n',
        'app/build.gradle': 'dependencies { implementation libs.guava }',
      },
      deps: [dep('implementation', 'org.example:guava:1.0', { fromCatalog: true })],
    });
    expect(candidate(scanned, 'org.example:guava')!.declaration).toMatchObject({ kind: 'catalog', catalogName: 'libs', entry: 'versions.guava' });
  });

  it('GRDCAT-04 An entry with strictly is listed as not offered', async () => {
    const scanned = await run({
      files: {
        [CATALOG]: '[versions]\nlib = { strictly = "1.0" }\n\n[libraries]\nlib = { module = "org.example:lib", version.ref = "lib" }\n',
        'app/build.gradle': 'dependencies { implementation libs.lib }',
      },
      deps: [dep('implementation', 'org.example:lib:1.0', { fromCatalog: true, strictly: '1.0' })],
    });
    expect(skippedOf(scanned, 'org.example:lib')).toMatchObject({ reason: 'version-constraint', detail: "strictly '1.0'" });
  });

  it('GRDCAT-06 A library without a version is no subject', async () => {
    const scanned = await run({
      files: { [CATALOG]: '[libraries]\nmanaged = { module = "org.example:managed" }\n', 'app/build.gradle': 'dependencies { implementation libs.managed }' },
      deps: [dep('implementation', 'org.example:managed', { fromCatalog: true })],
    });
    expect(scanned.result.candidates).toEqual([]);
    expect(scanned.result.skipped).toEqual([]);
  });

  it('GRDCAT-07 A version entry that several libraries refer to is shown as shared', async () => {
    const scanned = await run({
      files: {
        [CATALOG]:
          '[versions]\nslf4j = "1.0"\n\n[libraries]\napi = { module = "org.example:slf4j-api", version.ref = "slf4j" }\nsimple = { module = "org.example:slf4j-simple", version.ref = "slf4j" }\n',
        'app/build.gradle': 'dependencies { implementation libs.api; implementation libs.simple }',
      },
      deps: [
        dep('implementation', 'org.example:slf4j-api:1.0', { fromCatalog: true }),
        dep('implementation', 'org.example:slf4j-simple:1.0', { fromCatalog: true }),
      ],
    });
    expect(candidate(scanned, 'org.example:slf4j-api')!.sharedWith).toEqual(['org.example:slf4j-simple']);
    expect(candidate(scanned, 'org.example:slf4j-simple')!.sharedWith).toEqual(['org.example:slf4j-api']);
  });

  it('GRDCAT-08 An entry that no scanned module uses is not offered and not asked', async () => {
    const scanned = await run({
      files: { [CATALOG]: '[libraries]\nunused = "org.example:unused:1.0"\n', 'app/build.gradle': "plugins { id 'java' }" },
      deps: [],
    });
    expect(scanned.result.candidates).toEqual([]);
    expect(scanned.result.skipped).toEqual([]);
    expect(plannedLookups(scanned.fake)).toEqual([]);
  });

  it('GRDCAT-09 Two modules that use the same entry both offer it', async () => {
    const scanned = await run({
      scanned: [':', ':app'],
      files: {
        [CATALOG]: '[libraries]\nlib = "org.example:lib:1.0"\n',
        'build.gradle': 'dependencies { implementation libs.lib }',
        'app/build.gradle': 'dependencies { implementation libs.lib }',
      },
      deps: [dep('implementation', 'org.example:lib:1.0', { fromCatalog: true })],
      rootExtras: { repositories: [repo('MavenRepo')], dependencies: [dep('implementation', 'org.example:lib:1.0', { fromCatalog: true })] },
    });
    for (const module of scanned.modules) {
      const candidates = scanned.results.get(module)!.candidates;
      expect(candidates.map((c) => [c.coordinate.identifier, c.declaration!.entry]), module.id).toEqual([['org.example:lib', 'libraries.lib']]);
    }
  });

  it('GRDCAT-10 A literal and a catalog entry for the same coordinate are one candidate with two locations', async () => {
    const scanned = await run({
      files: {
        [CATALOG]: '[libraries]\nlib = "org.example:lib:1.0"\n',
        'app/build.gradle': "dependencies {\n    implementation libs.lib\n    testImplementation 'org.example:lib:1.0'\n}",
      },
      deps: [dep('implementation', 'org.example:lib:1.0', { fromCatalog: true }), dep('testImplementation', 'org.example:lib:1.0')],
    });
    expect(scanned.result.candidates).toHaveLength(1);
    expect(candidate(scanned, 'org.example:lib')!.declarations!.map((d) => d.displayPath).sort()).toEqual(['app/build.gradle', CATALOG]);
  });
});

describe('the channel and the kind of change (GRDVER-06 to GRDVER-12)', () => {
  const lib = (version: string, versions: string[], channel: 'stable' | 'all' = 'stable') =>
    run({
      files: { 'app/build.gradle': `dependencies { implementation 'org.example:lib:${version}' }` },
      deps: [dep('implementation', `org.example:lib:${version}`)],
      lookups: { 'org.example:lib': { versions } },
      channel,
    });

  it('GRDVER-06 The stable channel offers the highest stable version that is newer', async () => {
    const scanned = await lib('1.0', ['1.0', '1.1', '1.2-rc1', '2.0-beta1']);
    expect(scanned.result.candidates).toHaveLength(1);
    expect(candidate(scanned, 'org.example:lib')).toMatchObject({ newRange: '1.1', isPreRelease: false });
  });

  it('GRDVER-07 The all channel offers the highest version, pre-releases included', async () => {
    const scanned = await lib('1.0', ['1.0', '1.1', '1.2-rc1', '2.0-beta1'], 'all');
    expect(candidate(scanned, 'org.example:lib')).toMatchObject({ newRange: '2.0-beta1', isPreRelease: true, preReleaseTag: 'BETA', diff: 'major', selected: false });
  });

  it('GRDVER-08 A flavour suffix is kept', async () => {
    const scanned = await lib('31.0-jre', ['31.0-jre', '32.0-jre', '32.0-android', '33.0-android']);
    expect(candidate(scanned, 'org.example:lib')!.newRange).toBe('32.0-jre');
  });

  it('GRDVER-09 A pre-release as the current version still gets the highest stable version', async () => {
    const scanned = await lib('2.0-rc1', ['1.9', '2.0-rc1', '2.0-rc2', '2.0']);
    expect(candidate(scanned, 'org.example:lib')!.newRange).toBe('2.0');
  });

  it('GRDVER-10 Nothing newer means no candidate and no entry in the skipped list', async () => {
    const scanned = await lib('1.1', ['1.0', '1.1']);
    expect(scanned.result.candidates).toEqual([]);
    expect(scanned.result.skipped).toEqual([]);
  });

  it.each([
    ['1.0.0', '1.0.1', 'patch', true],
    ['1.0.0', '1.3.0', 'minor', true],
    ['1.0.0', '2.0.0', 'major', false],
  ])('GRDVER-11 %s to %s is %s, preselected: %s', async (current, latest, diff, selected) => {
    const scanned = await lib(current, [current, latest]);
    expect(candidate(scanned, 'org.example:lib')).toMatchObject({ diff, selected });
  });

  it('GRDVER-12 The available versions are the newer ones, newest first, and the current one', async () => {
    const scanned = await lib('1.0', ['1.0', '1.1', '1.2-rc1', '1.2', '2.0-beta1']);
    expect(candidate(scanned, 'org.example:lib')!.availableVersions).toEqual(['2.0-beta1', '1.2', '1.2-rc1', '1.1', '1.0']);
  });

  it('GRDVER-39 The versions of several repositories are merged and sorted', async () => {
    const scanned = await lib('1.0', ['1.0', '1.1', '1.2', '1.1', '1.3']);
    const c = candidate(scanned, 'org.example:lib')!;
    expect(c.newRange).toBe('1.3');
    expect(c.availableVersions).toEqual(['1.3', '1.2', '1.1', '1.0']);
  });

  it('GRDVER-40 A coordinate the repositories do not know is not an error', async () => {
    const scanned = await run({
      files: { 'app/build.gradle': "dependencies {\n    implementation 'org.example:a:1.0'\n    implementation 'org.example:b:1.0'\n}" },
      deps: [dep('implementation', 'org.example:a:1.0'), dep('implementation', 'org.example:b:1.0')],
      lookups: { 'org.example:a': { versions: [] }, 'org.example:b': { versions: ['1.0', '1.1'] } },
    });
    expect(candidate(scanned, 'org.example:a')).toBeUndefined();
    expect(skippedOf(scanned, 'org.example:a')).toBeUndefined();
    expect(candidate(scanned, 'org.example:b')).toBeDefined();
  });
});

describe('repositories and the guard (GRDVER-20 to GRDVER-24, GRDVER-33 to GRDVER-38)', () => {
  const guarded = (extra: Scenario = {}) =>
    run({
      internalScopes: ['com.acme'],
      files: { 'app/build.gradle': "dependencies { implementation 'com.acme.billing:core:1.0' }" },
      deps: [dep('implementation', 'com.acme.billing:core:1.0')],
      ...extra,
    });

  it('GRDVER-20 A public dependency is looked up in all repositories without a guard', async () => {
    const scanned = await run({
      files: { 'app/build.gradle': "dependencies { implementation 'com.google.guava:guava:31.0-jre' }" },
      deps: [dep('implementation', 'com.google.guava:guava:31.0-jre')],
      lookups: { 'com.google.guava:guava': { versions: ['31.0-jre', '33.0-jre'] } },
    });
    expect(candidate(scanned, 'com.google.guava:guava')).toMatchObject({ origin: { kind: 'public' }, newRange: '33.0-jre' });
    expect(scanned.fake.plans[0]!.internalGroupPatterns).toEqual([]);
  });

  it('GRDVER-21 An internal dependency is looked up when the build has a private repository', async () => {
    const scanned = await guarded({
      repositories: [repo('MavenRepo'), repo('corp', 'https://nexus.acme.example/repository/releases/')],
    });
    expect(candidate(scanned, 'com.acme.billing:core')!.origin).toEqual({ kind: 'private', matchedBy: 'internal-scope' });
    expect(scanned.fake.plans[0]).toMatchObject({
      publicRepositoryUrls: ['https://repo.maven.apache.org/maven2'],
      internalGroupPatterns: ['com\\.acme(\\..*)?'],
    });
  });

  it('GRDVER-22 An internal dependency with only public repositories is not looked up and no run is started for it', async () => {
    const scanned = await guarded();
    expect(scanned.result.candidates).toEqual([]);
    expect(scanned.result.skipped).toEqual([
      { identifier: 'com.acme.billing:core', origin: 'private', reason: 'private-on-public-registry', detail: 'https://repo.maven.apache.org/maven2/' },
    ]);
    expect(scanned.fake.lookupRuns).toHaveLength(0);
  });

  const conventions = { group: 'com.acme.conventions', name: 'com.acme.conventions.gradle.plugin', version: '1.0' };

  it('GRDVER-23 An internal plugin id is guarded like a group', async () => {
    const scanned = await run({
      internalScopes: ['com.acme'],
      files: { 'app/build.gradle': "plugins { id 'com.acme.conventions' version '1.0' }" },
      deps: [],
      buildscriptDependencies: [conventions],
      buildscriptRepositories: [repo('Gradle Central Plugin Repository', 'https://plugins.gradle.org/m2')],
    });
    expect(scanned.result.candidates).toEqual([]);
    expect(scanned.result.skipped).toEqual([
      { identifier: 'com.acme.conventions', origin: 'private', reason: 'private-on-public-registry', detail: 'https://plugins.gradle.org/m2' },
    ]);
  });

  it('GRDVER-24 An internal plugin id with a private plugin repository is looked up there', async () => {
    const scanned = await run({
      internalScopes: ['com.acme'],
      files: { 'app/build.gradle': "plugins { id 'com.acme.conventions' version '1.0' }" },
      deps: [],
      buildscriptDependencies: [conventions],
      pluginRepositories: [repo('corp-plugins', 'https://nexus.acme.example/plugins'), repo('Gradle Central Plugin Repository', 'https://plugins.gradle.org/m2')],
      buildscriptRepositories: [repo('__plugin_repository__corp-plugins', null), repo('__plugin_repository__Gradle Central Plugin Repository', null)],
      lookups: { 'com.acme.conventions:com.acme.conventions.gradle.plugin': { versions: ['1.0', '1.1'] } },
    });
    expect(candidate(scanned, 'com.acme.conventions')).toMatchObject({ origin: { kind: 'private' }, newRange: '1.1' });
    expect(scanned.fake.plans[0]!.lookups).toEqual([
      { id: 'L1', buildRoot: scanned.root, project: ':app', kind: 'plugin', group: 'com.acme.conventions', name: 'com.acme.conventions.gradle.plugin' },
    ]);
  });

  it('GRDVER-18 Credentials never leave the scan', async () => {
    const scanned = await run({
      repositories: [repo('corp', 'https://deploy:s3cret@repo.maven.apache.org/maven2/')],
      lookups: { 'org.example:lib': { versions: [], error: "Could not resolve org.example:lib:+. > Could not GET 'https://deploy:s3cret@repo.maven.apache.org/x'. Received status code 500" } },
    });
    expect(JSON.stringify(scanned.fake.plans)).not.toContain('s3cret');
    expect(JSON.stringify(scanned.result)).not.toContain('s3cret');
    expect(scanned.fake.plans[0]!.publicRepositoryUrls).toEqual(['https://repo.maven.apache.org/maven2']);
  });

  it('GRDVER-33 The plan names every coordinate, with the project that decides its repositories', async () => {
    const scanned = await run({
      files: { 'app/build.gradle': "dependencies {\n    implementation 'org.example:a:1.0'\n    implementation 'org.example:b:1.0'\n}" },
      deps: [dep('implementation', 'org.example:a:1.0'), dep('implementation', 'org.example:b:1.0')],
    });
    expect(scanned.fake.plans).toEqual([
      {
        protocol: 1,
        publicRepositoryUrls: ['https://repo.maven.apache.org/maven2'],
        internalGroupPatterns: [],
        lookups: [
          { id: 'L1', buildRoot: scanned.root, project: ':app', kind: 'module', group: 'org.example', name: 'a' },
          { id: 'L2', buildRoot: scanned.root, project: ':app', kind: 'module', group: 'org.example', name: 'b' },
        ],
      },
    ]);
  });

  it('GRDVER-34 The lookup run has the arguments of the protocol and a timeout of 5 minutes', async () => {
    const scanned = await run();
    const [lookupRun] = scanned.fake.lookupRuns;
    const id = /elevate-([0-9a-f]{8})/.exec(lookupRun!.args.join(' '))![1];
    expect(lookupRun!.args).toEqual([
      '-q', '-m', '--console=plain', '--no-configuration-cache', '-Delevate.mode=lookup',
      `-Delevate.plan=.gradle/elevate-${id}/plan.json`, `-Delevate.outDir=.gradle/elevate-${id}/out`,
      '-I', `.gradle/elevate-${id}/probe.init.gradle`, 'help',
    ].map((arg) => arg.replaceAll('/', process.platform === 'win32' ? '\\' : '/')));
    expect(lookupRun!.timeoutMs).toBe(5 * 60_000);
  });

  it('GRDVER-35 Several modules share one describe run and one lookup run', async () => {
    const scanned = await run({
      scanned: [':', ':app'],
      files: { 'build.gradle': "dependencies { implementation 'org.example:a:1.0' }" },
      deps: [dep('implementation', 'org.example:a:1.0')],
      projects: () => [],
    });
    // `:` has no dependencies of its own in the double; both are scanned with the same runs.
    expect(scanned.fake.describeRuns).toHaveLength(1);
    expect(scanned.fake.lookupRuns).toHaveLength(1);
    expect(scanned.results.size).toBe(2);
  });

  it('GRDVER-37 Without anything to look up no lookup run is started', async () => {
    const scanned = await run({ deps: [], files: { 'app/build.gradle': "plugins { id 'java' }" } });
    expect(scanned.result.candidates).toEqual([]);
    expect(scanned.fake.runs).toHaveLength(1);
  });

  it('GRDVER-38 A module without repositories lists its dependencies as not looked up', async () => {
    const scanned = await run({
      repositories: [],
      files: { 'app/build.gradle': "dependencies {\n    implementation 'org.example:a:1.0'\n    implementation 'org.example:b:1.0'\n}" },
      deps: [dep('implementation', 'org.example:a:1.0'), dep('implementation', 'org.example:b:1.0')],
    });
    expect(scanned.result.candidates).toEqual([]);
    expect(scanned.result.skipped.map((s) => [s.identifier, s.origin, s.reason, s.detail])).toEqual([
      ['org.example:a', 'public', 'lookup-failed', 'the build declares no repository for :app'],
      ['org.example:b', 'public', 'lookup-failed', 'the build declares no repository for :app'],
    ]);
    expect(scanned.fake.lookupRuns).toHaveLength(0);
  });
});

describe('failed lookups (GRDVER-41 to GRDVER-44)', () => {
  const twoDeps = {
    files: { 'app/build.gradle': "dependencies {\n    implementation 'org.example:a:1.0'\n    implementation 'org.example:b:1.0'\n}" },
    deps: [dep('implementation', 'org.example:a:1.0'), dep('implementation', 'org.example:b:1.0')],
  };
  const cause = "Could not GET 'https://nexus.acme.example/releases/org/example/a/maven-metadata.xml'. Received status code 401 from server: Unauthorized";

  it.each([
    ['Repository MavenRepo is disabled due to earlier error below:'],
    ['Skipped due to earlier error'],
  ])('GRDVER-41 A repository error is a failed lookup; a later note takes the cause of the first: %s', async (note) => {
    const scanned = await run({
      ...twoDeps,
      lookups: {
        'org.example:a': { versions: [], error: `Could not resolve org.example:a:+. > Failed to list versions for org.example:a. > ${cause}` },
        'org.example:b': { versions: [], error: `Could not resolve org.example:b:+. > ${note}` },
      },
    });
    expect(scanned.result.candidates).toEqual([]);
    expect(scanned.result.skipped).toEqual([
      { identifier: 'org.example:a', origin: 'public', reason: 'lookup-failed', detail: cause },
      { identifier: 'org.example:b', origin: 'public', reason: 'lookup-failed', detail: cause },
    ]);
  });

  it('GRDVER-42 Versions seen before a repository failed are not used', async () => {
    const scanned = await run({
      lookups: { 'org.example:lib': { versions: ['1.0', '1.1'], error: "Could not resolve org.example:lib:+. > Could not GET 'https://corp/a'. Received status code 500 from server: Internal Server Error" } },
    });
    expect(scanned.result.candidates).toEqual([]);
    expect(skippedOf(scanned, 'org.example:lib')).toMatchObject({ reason: 'lookup-failed' });
  });

  it('GRDVER-43 A lookup run that fails fails the scan of its modules', async () => {
    gradle.fake.lookupFailure = { exitCode: 1, stderr: 'FAILURE: Build failed with an exception.\n\n* What went wrong:\nCould not compile initialization script.\n\n* Try:\n> x' };
    await expect(scan(gradle.fake, { lookupFailure: gradle.fake.lookupFailure })).rejects.toThrow(
      'Gradle could not look up newer versions:\nFAILURE: Build failed with an exception.\n\n* What went wrong:\nCould not compile initialization script.',
    );
  });

  it('GRDVER-43 A lookup that no document answers is a failed lookup', async () => {
    const scanned = await run({ noAnswer: ['org.example:lib'] });
    expect(skippedOf(scanned, 'org.example:lib')).toMatchObject({ reason: 'lookup-failed', detail: 'Gradle gave no answer for this lookup.' });
  });

  it('GRDVER-44 A lookup run that does not finish is stopped and named', async () => {
    await expect(scan(gradle.fake, { lookupFailure: { exitCode: 1, timedOut: true } })).rejects.toThrow(
      'Gradle timed out after 5 minutes while looking up newer versions.',
    );
  });
});

describe('included builds are aligned, never looked up (GRDVER-25 to GRDVER-30)', () => {
  const included = (group: string | null, version: string, dir = 'lib', name = 'lib') => (root: string) => {
    const path = join(root, dir);
    return [buildDoc(name, path, [projectDoc(':', path, { name, group, version, buildFile: join(path, 'build.gradle') })], { kind: 'included' })];
  };
  const dependsOn = (coordinate: string, extra: Scenario = {}) => ({
    files: { 'app/build.gradle': `dependencies { implementation '${coordinate}' }` },
    deps: [dep('implementation', coordinate)],
    ...extra,
  });

  it('GRDVER-25 A dependency on an included build is aligned, never looked up', async () => {
    const scanned = await run(dependsOn('com.acme:lib:1.0.0', { included: included('com.acme', '2.0.0') }));
    expect(candidate(scanned, 'com.acme:lib')).toMatchObject({
      action: 'align', newRange: '2.0.0', diff: 'major', selected: false, availableVersions: ['2.0.0'],
      origin: { kind: 'workspace', moduleId: ':lib', moduleRelPath: 'lib' },
    });
    expect(plannedLookups(scanned.fake)).toEqual([]);
  });

  it('GRDVER-26 A dependency that already has the version of the included build is left alone', async () => {
    const scanned = await run(dependsOn('com.acme:lib:2.0.0', { included: included('com.acme', '2.0.0') }));
    expect(scanned.result.candidates).toEqual([]);
    expect(scanned.result.skipped).toEqual([]);
    expect(plannedLookups(scanned.fake)).toEqual([]);
  });

  it('GRDVER-27 An included build wins over the internal scopes', async () => {
    const scanned = await run(dependsOn('com.acme:lib:1.0.0', { included: included('com.acme', '2.0.0'), internalScopes: ['com.acme'] }));
    expect(candidate(scanned, 'com.acme:lib')!.origin.kind).toBe('workspace');
  });

  it('GRDVER-28 A project of the same build with the same coordinates is an ordinary dependency', async () => {
    const scanned = await run(
      dependsOn('com.acme:core:2.1.0', {
        projects: (root) => [projectDoc(':core', join(root, 'core'), { name: 'core', group: 'com.acme', version: '3.0.0' })],
        lookups: { 'com.acme:core': { versions: ['2.1.0', '2.2.0'] } },
      }),
    );
    expect(candidate(scanned, 'com.acme:core')).toMatchObject({ action: 'update', origin: { kind: 'public' }, newRange: '2.2.0' });
  });

  it('GRDVER-29 An included build without a group is an ordinary dependency', async () => {
    const scanned = await run(
      dependsOn('shared-lib:shared-lib:1.0', {
        included: included(null, '3.1.4', 'shared', 'shared-lib'),
        lookups: { 'shared-lib:shared-lib': { versions: ['1.0', '1.1'] } },
      }),
    );
    expect(candidate(scanned, 'shared-lib:shared-lib')).toMatchObject({ action: 'update', origin: { kind: 'public' } });
  });

  /** A module of an included build, which the harness scans next to the root build. */
  const includedModule = (root: string, dir: string, id: string): import('../../src/domain/models.js').ProjectModule => ({
    id, name: dir, path: join(root, dir), relPath: dir, ecosystem: 'gradle', isRoot: false,
    buildDir: root, buildRoot: join(root, dir), buildKind: 'included',
  });

  it('GRDVER-31 The root build is not substituted in an included build', async () => {
    const scanned = await run({
      files: { 'lib/build.gradle': "dependencies { implementation 'com.acme:mono:0.9' }" },
      rootExtras: { group: 'com.acme', name: 'mono', version: '1.0.0' },
      lookups: { 'com.acme:mono': { versions: ['0.9', '1.0'] } },
      included: (root) => {
        const dir = join(root, 'lib');
        return [
          buildDoc('lib', dir, [
            projectDoc(':', dir, {
              name: 'lib', group: 'com.acme', version: '2.0.0', buildFile: join(dir, 'build.gradle'),
              repositories: [repo('MavenRepo')], dependencies: [dep('implementation', 'com.acme:mono:0.9')],
            }),
          ], { kind: 'included' }),
        ];
      },
      modules: (root) => [includedModule(root, 'lib', ':lib')],
    });
    expect(candidate(scanned, 'com.acme:mono')).toMatchObject({ action: 'update', origin: { kind: 'public' }, newRange: '1.0' });
  });

  it('GRDVER-32 One included build can depend on any project of another by coordinates', async () => {
    const scanned = await run({
      files: {
        'tools/build.gradle': "dependencies {\n    implementation 'com.acme:lib:1.0.0'\n    implementation 'com.acme.sub:sub:1.0.0'\n}",
      },
      included: (root) => {
        const lib = join(root, 'lib');
        const tools = join(root, 'tools');
        return [
          buildDoc('lib', lib, [
            projectDoc(':', lib, { name: 'lib', group: 'com.acme', version: '2.0.0' }),
            projectDoc(':sub', join(lib, 'sub'), { name: 'sub', group: 'com.acme.sub', version: '3.0.0' }),
          ], { kind: 'included' }),
          buildDoc('tools', tools, [
            projectDoc(':', tools, {
              name: 'tools', group: null, version: '5.0.0', buildFile: join(tools, 'build.gradle'), repositories: [repo('MavenRepo')],
              dependencies: [dep('implementation', 'com.acme:lib:1.0.0'), dep('implementation', 'com.acme.sub:sub:1.0.0')],
            }),
          ], { kind: 'included' }),
        ];
      },
      modules: (root) => [includedModule(root, 'tools', ':tools')],
    });
    expect(candidate(scanned, 'com.acme:lib')).toMatchObject({ action: 'align', newRange: '2.0.0' });
    expect(candidate(scanned, 'com.acme.sub:sub')).toMatchObject({ action: 'align', newRange: '3.0.0' });
  });

  it('GRDVER-30 An included build outside the repository is neither looked up nor offered nor listed', async () => {
    const scanned = await run(dependsOn('org.ext:ext-lib:1.0', { included: included('org.ext', '7.0', '../ext-lib', 'ext-lib') }));
    expect(scanned.result.candidates).toEqual([]);
    expect(scanned.result.skipped).toEqual([]);
    expect(plannedLookups(scanned.fake)).toEqual([]);
  });
});

describe('the usual script', () => {
  it('is what the other scenarios start from', () => {
    expect(USUAL_SCRIPT).toContain('org.example:lib:1.0');
  });
});
