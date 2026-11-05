import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assessDependency, isTestConfiguration } from '../../src/adapters/gradle/gradle-locator.js';
import { applyGradleEdits, findStringLiterals } from '../../src/adapters/gradle/gradle-text.js';
import { StaleEditError } from '../../src/adapters/shared/xml.js';
import { applyTo, declarationsOf, failure, locate } from '../gradle-locate.js';
import type { Options } from '../gradle-locate.js';
import { cleanupTemp } from '../helpers.js';

afterEach(cleanupTemp);

describe('literals (GRDDEC-01 to GRDDEC-03, GRDDEC-32 to GRDDEC-34)', () => {
  it('GRDDEC-01 A dependency in string notation is located', () => {
    const { root, result } = locate({ 'app/build.gradle': "dependencies { implementation 'org.example:lib:1.0' }" });
    const [d] = declarationsOf(result);
    expect(d).toMatchObject({ file: join(root, 'app/build.gradle'), kind: 'dependency', displayPath: 'app/build.gradle' });
  });

  it.each([
    ['build.gradle', "dependencies { implementation 'org.example:lib:1.0' }"],
    ['build.gradle', 'dependencies { implementation "org.example:lib:1.0" }'],
    ['build.gradle', "dependencies { implementation('org.example:lib:1.0') }"],
    ['build.gradle', "dependencies { implementation group: 'org.example', name: 'lib', version: '1.0' }"],
    ['build.gradle', 'dependencies { implementation name: \'lib\', version: \'1.0\', group: "org.example" }'],
    ['build.gradle.kts', 'dependencies { implementation("org.example:lib:1.0") }'],
    ['build.gradle.kts', 'dependencies { implementation(group = "org.example", name = "lib", version = "1.0") }'],
    ['build.gradle.kts', 'dependencies { implementation("""org.example:lib:1.0""") }'],
  ])('GRDDEC-02 %s: %s', (script, line) => {
    const { root, result } = locate({ [`app/${script}`]: line }, { script });
    const changed = applyTo(declarationsOf(result)).get(join(root, 'app', script));
    expect(changed).toBe(line.replace('1.0', '1.1'));
  });

  it('GRDDEC-03 A classifier and an extension survive the update', () => {
    const line = "dependencies { runtimeOnly 'org.example:lib:1.0:tests@zip' }";
    const { root, result } = locate({ 'app/build.gradle': line });
    expect(applyTo(declarationsOf(result)).get(join(root, 'app/build.gradle'))).toBe(
      "dependencies { runtimeOnly 'org.example:lib:1.1:tests@zip' }",
    );
  });

  it('GRDDEC-07 Every literal of the coordinate in the script is written', () => {
    const source = "dependencies {\n    implementation 'org.example:lib:1.0'\n    testImplementation 'org.example:lib:1.0'\n}";
    const { root, result } = locate({ 'app/build.gradle': source });
    expect(declarationsOf(result)).toHaveLength(2);
    expect(applyTo(declarationsOf(result)).get(join(root, 'app/build.gradle'))).toBe(source.replaceAll('1.0', '1.1'));
  });

  it.each([
    ["implementation platform('org.example:bom:1.0')", 'dependency'],
    ["implementation enforcedPlatform('org.example:bom:1.0')", 'dependency'],
    ["constraints { implementation('org.example:bom:1.0') { because 'x' } }", 'dependency-management'],
  ])('GRDDEC-09 %s has the kind %s', (declaration, kind) => {
    const { result } = locate({ 'app/build.gradle': `dependencies {\n    ${declaration}\n}` }, { name: 'bom' });
    expect(declarationsOf(result)[0]!.kind).toBe(kind);
  });

  it('GRDDEC-10 A dependency and a constraint are two locations, the dependency first', () => {
    const source = "dependencies {\n    constraints { implementation 'org.example:lib:1.0' }\n    implementation 'org.example:lib:1.0'\n}";
    const { root, result } = locate({ 'app/build.gradle': source });
    const declarations = declarationsOf(result);
    expect(declarations.map((d) => d.kind)).toEqual(['dependency', 'dependency-management']);
    expect(applyTo(declarations).get(join(root, 'app/build.gradle'))).toBe(source.replaceAll('1.0', '1.1'));
  });

  it('GRDDEC-11 A classpath dependency of a buildscript block is a dependency declaration', () => {
    const { result } = locate({ 'app/build.gradle': "buildscript {\n    dependencies { classpath 'org.example:lib:1.0' }\n}" });
    expect(declarationsOf(result)[0]!.kind).toBe('dependency');
  });

  it('GRDDEC-12 A dependency declared for all subprojects is found in the parent script', () => {
    const { root, result } = locate({
      'build.gradle': "subprojects { dependencies { testImplementation 'org.example:lib:1.0' } }",
      'app/build.gradle': "plugins { id 'java' }",
    });
    expect(declarationsOf(result)[0]!.file).toBe(join(root, 'build.gradle'));
  });

  it('GRDDEC-12 The module own script wins over the parent: the parent is not searched', () => {
    const { root, result } = locate({
      'build.gradle': "subprojects { dependencies { testImplementation 'org.example:lib:1.0' } }",
      'app/build.gradle': "dependencies { implementation 'org.example:lib:1.0' }",
    });
    expect(declarationsOf(result).map((d) => d.file)).toEqual([join(root, 'app/build.gradle')]);
  });

  it('GRDDEC-32 A literal in a comment is not a declaration', () => {
    const source = [
      "// dependencies { implementation 'org.example:lib:1.0' }",
      "/* implementation 'org.example:lib:1.0' */",
      "dependencies { implementation 'org.example:lib:1.0' }",
    ].join('\n');
    const { root, result } = locate({ 'app/build.gradle': source });
    const changed = applyTo(declarationsOf(result)).get(join(root, 'app/build.gradle'))!.split('\n');
    expect(changed[0]).toContain('1.0');
    expect(changed[1]).toContain('1.0');
    expect(changed[2]).toContain('1.1');
  });

  it('GRDDEC-33 A rule that names the same coordinate and version moves along', () => {
    const source =
      "dependencies { implementation 'org.example:lib:1.0' }\nconfigurations.all { resolutionStrategy { force 'org.example:lib:1.0' } }";
    const { root, result } = locate({ 'app/build.gradle': source });
    expect(applyTo(declarationsOf(result)).get(join(root, 'app/build.gradle'))).toBe(source.replaceAll('1.0', '1.1'));
  });

  it.each([
    ['tabs and LF line endings', '// header\ndependencies {\n\timplementation \'org.example:lib:1.0\'   // keep\n}'],
    ['spaces and CRLF line endings and a final line break', "// header\r\ndependencies {\r\n    implementation 'org.example:lib:1.0'   // keep\r\n}\r\n"],
    ['a byte order mark and no final line break', "﻿// header\ndependencies {\n    implementation 'org.example:lib:1.0'   // keep\n}"],
  ])('GRDDEC-34 Layout, quotes and line endings are preserved: %s', (_style, source) => {
    const { root, result } = locate({ 'app/build.gradle': source });
    expect(applyTo(declarationsOf(result)).get(join(root, 'app/build.gradle'))).toBe(source.replace('1.0', '1.1'));
  });

  it.each([
    ['dependencies { implementation "org.example:lib:${versions.lib}" }'],
    ['dependencies { implementation "org.example:lib:${project.version}" }'],
    ['dependencies { implementation "org.example:lib:$v-jre" }'],
    ['dependencies { implementation "org.example:lib:" + lib() }'],
    ['dependencies { implementation(libraries.lib) }'],
  ])('GRDDEC-30 A version that is computed is not located: %s', (line) => {
    const { result } = locate({ 'app/build.gradle': line });
    expect(failure(result)).toBe(
      'no declaration of org.example:lib:1.0 found in app/build.gradle or in the build scripts of its parent projects',
    );
  });

  it('GRDDEC-31 A version that only a convention plugin declares is not located', () => {
    const { result } = locate({
      'buildSrc/src/main/groovy/conventions.gradle': "dependencies { implementation 'org.example:lib:1.0' }",
      'app/build.gradle': "plugins { id 'conventions' }",
    });
    expect(failure(result)).toContain('no declaration of org.example:lib:1.0 found in app/build.gradle');
  });

  it('A single-quoted string is not interpolated', () => {
    const { result } = locate({ 'app/build.gradle': "def v = '1.0'\ndependencies { implementation 'org.example:lib:$v' }" });
    expect(result.ok).toBe(false);
  });
});

describe('names as the version (GRDDEC-13 to GRDDEC-22)', () => {
  it('GRDDEC-13 A version from the gradle.properties of the build', () => {
    const { root, result } = locate({
      'gradle.properties': 'jacksonVersion=1.0',
      'app/build.gradle': 'dependencies { implementation "org.example:lib:$jacksonVersion" }',
    });
    const [d] = declarationsOf(result);
    expect(d).toMatchObject({ file: join(root, 'gradle.properties'), kind: 'property', propertyName: 'jacksonVersion' });
    expect(applyTo([d!]).get(join(root, 'gradle.properties'))).toBe('jacksonVersion=1.1');
  });

  it('GRDDEC-14 The gradle.properties of the module wins over the one of the build', () => {
    const { root, result } = locate({
      'gradle.properties': 'v=0.9',
      'app/gradle.properties': 'v=1.0',
      'app/build.gradle': 'dependencies { implementation "org.example:lib:${v}" }',
    });
    expect(declarationsOf(result)[0]!.file).toBe(join(root, 'app/gradle.properties'));
  });

  it.each([
    ['build.gradle', "def v = '1.0'", 'dependencies { implementation "org.example:lib:$v" }'],
    ['build.gradle', "String v = '1.0'", 'dependencies { implementation "org.example:lib:${v}" }'],
    ['build.gradle', "ext.v = '1.0'", 'dependencies { implementation "org.example:lib:$v" }'],
    ['build.gradle', "ext { v = '1.0' }", 'dependencies { implementation "org.example:lib:$v" }'],
    ['build.gradle', "def v = '1.0'", "dependencies { implementation group: 'org.example', name: 'lib', version: v }"],
    ['build.gradle.kts', 'val v = "1.0"', 'dependencies { implementation("org.example:lib:$v") }'],
    ['build.gradle.kts', 'val v: String = "1.0"', 'dependencies { implementation("org.example:lib:${v}") }'],
    ['build.gradle.kts', 'extra["v"] = "1.0"', 'dependencies { implementation("org.example:lib:$v") }'],
    ['build.gradle.kts', 'val v by extra("1.0")', 'dependencies { implementation("org.example:lib:$v") }'],
  ])('GRDDEC-15 %s: %s', (script, definition, reference) => {
    const { root, result } = locate({ [`app/${script}`]: `${definition}\n${reference}` }, { script });
    const [d] = declarationsOf(result);
    expect(d).toMatchObject({ kind: 'property', propertyName: 'v' });
    expect(applyTo([d!]).get(join(root, 'app', script))).toBe(`${definition.replace('1.0', '1.1')}\n${reference}`);
  });

  it('GRDDEC-16 A name defined in the script of a parent project is found', () => {
    const { root, result } = locate({
      'build.gradle': "ext { v = '1.0' }",
      'app/build.gradle': 'dependencies { implementation "org.example:lib:$v" }',
    });
    expect(declarationsOf(result)[0]).toMatchObject({ file: join(root, 'build.gradle'), kind: 'property', propertyName: 'v' });
  });

  it('GRDDEC-17 The nearest definition wins', () => {
    const { root, result } = locate({
      'build.gradle': "ext { v = '0.9' }",
      'app/build.gradle': "ext { v = '1.0' }\ndependencies { implementation \"org.example:lib:$v\" }",
    });
    expect(declarationsOf(result)[0]!.file).toBe(join(root, 'app/build.gradle'));
  });

  it('GRDDEC-18 Two dependencies that share a name locate the same text', () => {
    const files = {
      'gradle.properties': 'jacksonVersion=1.0',
      'app/build.gradle': 'dependencies {\n    implementation "org.example:core:$jacksonVersion"\n    implementation "org.example:databind:$jacksonVersion"\n}',
    };
    const core = declarationsOf(locate(files, { name: 'core' }).result)[0]!;
    const databind = declarationsOf(locate(files, { name: 'databind' }).result)[0]!;
    expect(core.range).toEqual(databind.range);
    expect(core.displayPath).toBe('gradle.properties');
  });

  it.each([
    [''],
    ['ext { v = computeVersion() }'],
    ['ext { v = "1.${minor}" }'],
    ["def v = '1.' + '0'"],
  ])('GRDDEC-20 A name without a plain definition is not located: %s', (definition) => {
    const { result } = locate({ 'app/build.gradle': `${definition}\ndependencies { implementation "org.example:lib:$v" }` });
    expect(failure(result)).toBe(
      "no definition of 'v' in gradle.properties or in the build scripts of ':app' and its parent projects",
    );
  });

  it('GRDDEC-21 A value that Gradle overrides is not edited', () => {
    const { result } = locate({
      'gradle.properties': 'v=0.9',
      'app/build.gradle': 'dependencies { implementation "org.example:lib:$v" }',
    });
    expect(failure(result)).toBe("'v' is 0.9 in gradle.properties but Gradle uses 1.0 (command line or user-level override?)");
  });

  it('GRDDEC-22 A name defined twice at the same level is ambiguous', () => {
    const { result } = locate({
      'app/build.gradle': "def v = '1.0'\next.v = '1.0'\ndependencies { implementation \"org.example:lib:$v\" }",
    });
    expect(failure(result)).toBe("'v' is defined twice in app/build.gradle");
  });
});

describe('plugins (GRDDEC-23 to GRDDEC-27)', () => {
  const plugin: Options = { group: 'org.example.plugin', name: 'org.example.plugin.gradle.plugin', isPlugin: true };

  it.each([
    ['build.gradle', "plugins { id 'org.example.plugin' version '1.0' }"],
    ['build.gradle', 'plugins { id("org.example.plugin") version("1.0") }'],
    ['build.gradle.kts', 'plugins { id("org.example.plugin") version "1.0" }'],
  ])('GRDDEC-23 %s: %s', (script, line) => {
    const { root, result } = locate({ [`app/${script}`]: line }, { ...plugin, script });
    const [d] = declarationsOf(result);
    expect(d!.kind).toBe('plugin');
    expect(applyTo([d!]).get(join(root, 'app', script))).toBe(line.replace('1.0', '1.1'));
  });

  it('GRDDEC-24 A Kotlin plugin shorthand stands for its full id', () => {
    const { root, result } = locate(
      { 'app/build.gradle.kts': 'plugins { kotlin("jvm") version "1.0" }' },
      { group: 'org.jetbrains.kotlin.jvm', name: 'org.jetbrains.kotlin.jvm.gradle.plugin', isPlugin: true, script: 'build.gradle.kts' },
    );
    expect(declarationsOf(result)[0]!.file).toBe(join(root, 'app/build.gradle.kts'));
  });

  it('GRDDEC-25 A plugin version declared in the parent script is found from the module', () => {
    const { root, result } = locate(
      {
        'build.gradle': "plugins { id 'org.example.plugin' version '1.0' apply false }",
        'app/build.gradle': "plugins { id 'org.example.plugin' }",
      },
      plugin,
    );
    expect(declarationsOf(result)[0]!.file).toBe(join(root, 'build.gradle'));
  });

  it('GRDDEC-26 A plugin version declared in pluginManagement of the settings is found', () => {
    const { root, result } = locate(
      {
        'settings.gradle': "pluginManagement { plugins { id 'org.example.plugin' version '1.0' } }; include 'app'",
        'app/build.gradle': "plugins { id 'org.example.plugin' }",
      },
      plugin,
    );
    expect(declarationsOf(result)[0]).toMatchObject({ file: join(root, 'settings.gradle'), kind: 'plugin' });
  });
});

describe('what is not a plain version (GRDDEC-05, GRDDEC-06, GRDDEC-28, GRDDEC-29)', () => {
  const dep = (over: Partial<Parameters<typeof assessDependency>[0]>) =>
    assessDependency({ group: 'org.example', name: 'lib', version: '1.0', strictly: null, preferred: null, rejected: [], ...over });

  it('A plain version is located', () => {
    expect(dep({})).toEqual({ action: 'locate' });
  });

  it('GRDDEC-05 A module without a version is not a subject and not listed', () => {
    expect(dep({ version: null })).toEqual({ action: 'ignore' });
  });

  it('GRDDEC-06 A dependency without a group is listed as invalid-name', () => {
    expect(dep({ group: null })).toEqual({ action: 'skip', reason: 'invalid-name', detail: 'no group' });
  });

  it.each(['1.+', '+', '1.0.+', 'latest.release', 'latest.integration', '[1.0,2.0)', '(1.0,]', ']1.0,2.0]'])(
    "GRDDEC-28 Dynamic version '%s' is the declaration, not a version",
    (version) => {
      expect(dep({ version })).toEqual({ action: 'skip', reason: 'version-constraint', detail: `dynamic version '${version}'` });
    },
  );

  it.each([
    [{ strictly: '1.0' }, "strictly '1.0'"],
    [{ rejected: ['1.1'] }, "reject '1.1'"],
    [{ preferred: '1.0' }, "prefer '1.0'"],
  ])('GRDDEC-29 %j is not edited', (over, detail) => {
    expect(dep(over)).toEqual({ action: 'skip', reason: 'version-constraint', detail });
  });

  it.each([
    ['implementation', false],
    ['api', false],
    ['compileOnly', false],
    ['runtimeOnly', false],
    ['annotationProcessor', false],
    ['testImplementation', true],
    ['testRuntimeOnly', true],
    ['integrationTestImplementation', true],
    ['androidTestImplementation', true],
    ['testFixturesApi', true],
  ])('GRDDEC-04 %s is a test configuration: %s', (configuration, expected) => {
    expect(isTestConfiguration(configuration)).toBe(expected);
  });
});

describe('editing safely (GRDDEC-35, GRDDEC-36)', () => {
  it('GRDDEC-35 A file that changed since the scan is not overwritten, also when the old version is a prefix', () => {
    const { result } = locate({ 'app/build.gradle': "dependencies { implementation 'org.example:lib:1.0' }" });
    const [d] = declarationsOf(result);
    const edit = { ...d!.range, expected: '1.0', replacement: '1.1' };
    for (const changed of [
      "dependencies { implementation 'org.example:lib:1.0.1' }",
      "dependencies { implementation 'org.example:lib:2.0' }",
    ]) {
      expect(() => applyGradleEdits(changed, [edit])).toThrow(StaleEditError);
      expect(() => applyGradleEdits(changed, [edit])).toThrow(/changed since it was scanned/);
    }
    expect(() => applyGradleEdits("dependencies { implementation 'org.example:lib:1.0.1' }", [edit])).toThrow(/'1\.0\.1' found where '1\.0' was expected/);
  });

  it('Overlapping and conflicting edits are refused; equal edits on one range are applied once', () => {
    const source = 'abc 1.0 xyz';
    const edit = { start: 4, end: 7, expected: '1.0', replacement: '1.1' };
    expect(applyGradleEdits(source, [edit, { ...edit }])).toBe('abc 1.1 xyz');
    expect(() => applyGradleEdits(source, [edit, { ...edit, replacement: '1.2' }])).toThrow(StaleEditError);
    expect(() => applyGradleEdits(source, [edit, { start: 5, end: 8, expected: '.0 ', replacement: 'x' }])).toThrow(/Overlapping/);
  });
});

describe('string literals', () => {
  it('finds quotes of every kind outside comments and keeps offsets', () => {
    const source = `a 'x' // 'no'\nb "y\${z}" /* 'no' */ c '''t''' d "http://host/p"`;
    const literals = findStringLiterals(source, 'groovy');
    expect(literals.map((l) => l.value)).toEqual(['x', 'y${z}', 't', 'http://host/p']);
    for (const l of literals) expect(source.slice(l.start, l.end)).toBe(l.value);
  });
});
