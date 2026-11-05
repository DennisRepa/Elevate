import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { catalogVersionRange, parseCatalog } from '../../src/adapters/gradle/gradle-catalog.js';
import { locateDeclarations } from '../../src/adapters/gradle/gradle-locator.js';
import { applyGradleEdits } from '../../src/adapters/gradle/gradle-text.js';
import { StaleEditError } from '../../src/adapters/shared/xml.js';
import { buildDoc, projectDoc } from '../gradle-fake.js';
import { applyTo, declarationsOf, failure, locate } from '../gradle-locate.js';
import { cleanupTemp, makeTree } from '../helpers.js';

afterEach(cleanupTemp);

const CATALOG = 'gradle/libs.versions.toml';
const usesLib = { 'app/build.gradle': 'dependencies { implementation libs.lib }' };

describe('library entries (GRDCAT-01 to GRDCAT-03)', () => {
  it('GRDCAT-01 A library whose version is a reference is located at the version entry', () => {
    const catalog = '[versions]\nguava = "1.0"\n\n[libraries]\nguava = { module = "org.example:guava", version.ref = "guava" }\n';
    const { root, result } = locate(
      { [CATALOG]: catalog, 'app/build.gradle': 'dependencies { implementation libs.guava }' },
      { name: 'guava', viaCatalog: true },
    );
    const [d] = declarationsOf(result);
    expect(d).toMatchObject({ file: join(root, CATALOG), kind: 'catalog', catalogName: 'libs', entry: 'versions.guava', displayPath: CATALOG });
    expect(applyTo([d!]).get(join(root, CATALOG))).toBe(catalog.replace('1.0', '1.1'));
  });

  it.each([
    ['lib = { module = "org.example:lib", version = "1.0" }'],
    ['lib = { group = "org.example", name = "lib", version = "1.0" }'],
    ['lib = "org.example:lib:1.0"'],
    ['lib = { module = "org.example:lib", version = { require = "1.0" } }'],
  ])('GRDCAT-02 The other forms of a library entry are recognised: %s', (entry) => {
    const catalog = `[versions]\nother = "9.9"\n\n[libraries]\n${entry}\n`;
    const { root, result } = locate({ [CATALOG]: catalog, ...usesLib }, { viaCatalog: true });
    const [d] = declarationsOf(result);
    expect(d!.entry).toBe('libraries.lib');
    expect(applyTo([d!]).get(join(root, CATALOG))).toBe(catalog.replace('1.0', '1.1'));
  });

  it('GRDCAT-03 A version entry in the rich form with require is located', () => {
    const catalog = '[versions]\nlib = { require = "1.0" }\n\n[libraries]\nlib = { module = "org.example:lib", version.ref = "lib" }\n';
    const { root, result } = locate({ [CATALOG]: catalog, ...usesLib }, { viaCatalog: true });
    const [d] = declarationsOf(result);
    expect(d!.entry).toBe('versions.lib');
    expect(applyTo([d!]).get(join(root, CATALOG))).toBe(catalog.replace('1.0', '1.1'));
  });
});

describe('bundles and shared entries (GRDCAT-05, GRDCAT-07, GRDCAT-09, GRDCAT-10)', () => {
  it('GRDCAT-05 Members of a bundle are located as libraries', () => {
    const files = {
      [CATALOG]: '[libraries]\na = "org.example:a:1.0"\nb = "org.example:b:1.0"\n\n[bundles]\nboth = ["a", "b"]\n',
      'app/build.gradle': 'dependencies { implementation libs.bundles.both }',
    };
    expect(declarationsOf(locate(files, { name: 'a', viaCatalog: true }).result)[0]!.entry).toBe('libraries.a');
    expect(declarationsOf(locate(files, { name: 'b', viaCatalog: true }).result)[0]!.entry).toBe('libraries.b');
  });

  it('GRDCAT-07 A version entry that several libraries refer to is the same text and is written once', () => {
    const catalog =
      '[versions]\nslf4j = "1.0"\n\n[libraries]\napi = { module = "org.example:slf4j-api", version.ref = "slf4j" }\nsimple = { module = "org.example:slf4j-simple", version.ref = "slf4j" }\n';
    const files = { [CATALOG]: catalog, 'app/build.gradle': 'dependencies { implementation libs.api; implementation libs.simple }' };
    const api = declarationsOf(locate(files, { name: 'slf4j-api', viaCatalog: true }).result);
    const simple = declarationsOf(locate(files, { name: 'slf4j-simple', viaCatalog: true }).result);
    expect(api[0]!.range).toEqual(simple[0]!.range);
    const root = locate(files, { name: 'slf4j-api', viaCatalog: true }).root;
    const both = [...api, ...simple].map((d) => ({ ...d.range, expected: '1.0', replacement: '1.1' }));
    expect(applyGradleEdits(readFileSync(join(root, CATALOG), 'utf8'), both)).toContain('slf4j = "1.1"');
    expect(applyGradleEdits(readFileSync(join(root, CATALOG), 'utf8'), both).match(/1\.1/g)).toHaveLength(1);
  });

  it('GRDCAT-10 A literal and a catalog entry for the same coordinate both change', () => {
    const script = "dependencies {\n    implementation libs.lib\n    testImplementation 'org.example:lib:1.0'\n}";
    const { root, result } = locate(
      { [CATALOG]: '[libraries]\nlib = "org.example:lib:1.0"\n', 'app/build.gradle': script },
      { viaScripts: true, viaCatalog: true },
    );
    const declarations = declarationsOf(result);
    expect(declarations.map((d) => d.displayPath).sort()).toEqual(['app/build.gradle', CATALOG]);
    const changed = applyTo(declarations);
    expect(changed.get(join(root, 'app/build.gradle'))).toBe(script.replace('1.0', '1.1'));
    expect(changed.get(join(root, CATALOG))).toBe('[libraries]\nlib = "org.example:lib:1.1"\n');
  });

  it('A part that cannot be located makes the whole coordinate not offered', () => {
    const { result } = locate(
      { [CATALOG]: '[libraries]\nlib = "org.example:lib:1.0"\n', 'app/build.gradle': 'dependencies { implementation libs.lib }' },
      { viaScripts: true, viaCatalog: true },
    );
    expect(failure(result)).toContain('no declaration of org.example:lib:1.0 found in app/build.gradle');
  });
});

describe('what is not located (GRDCAT-11, GRDCAT-12)', () => {
  it('GRDCAT-11 Two entries with the same coordinate and version are ambiguous', () => {
    const catalog = '[libraries]\nlib = "org.example:lib:1.0"\nlib-again = { module = "org.example:lib", version = "1.0" }\n';
    const { result } = locate({ [CATALOG]: catalog, ...usesLib }, { viaCatalog: true });
    expect(failure(result)).toBe('2 entries of gradle/libs.versions.toml declare org.example:lib:1.0: lib, lib-again');
  });

  it('GRDCAT-12 Without gradle/libs.versions.toml there is no entry', () => {
    const { result } = locate({ ...usesLib }, { viaCatalog: true });
    expect(failure(result)).toBe(
      'no entry for org.example:lib:1.0 in gradle/libs.versions.toml (other catalogs are not read)',
    );
  });

  it('A catalog that is not valid TOML has no entry', () => {
    const { result } = locate({ [CATALOG]: '[libraries\nlib = ', ...usesLib }, { viaCatalog: true });
    expect(result.ok).toBe(false);
  });

  it('An entry whose version differs from the one Gradle reports is not matched', () => {
    const { result } = locate({ [CATALOG]: '[libraries]\nlib = "org.example:lib:0.9"\n', ...usesLib }, { viaCatalog: true });
    expect(result.ok).toBe(false);
  });
});

describe('included builds, accessors and plugins (GRDCAT-13 to GRDCAT-15)', () => {
  it('GRDCAT-13 An included build has its own catalog', () => {
    const root = makeTree({
      'settings.gradle': 'x',
      [CATALOG]: '[libraries]\nlib = "org.example:lib:0.9"\n',
      [`build-logic/${CATALOG}`]: '[libraries]\nlib = "org.example:lib:1.0"\n',
    });
    const dir = join(root, 'build-logic');
    const projects = [projectDoc(':', dir, { buildFile: join(dir, 'build.gradle') })];
    const result = locateDeclarations({
      rootDir: root,
      build: buildDoc('build-logic', dir, projects, { kind: 'included' }).build,
      project: projects[0]!,
      projects,
      group: 'org.example',
      name: 'lib',
      version: '1.0',
      isPlugin: false,
      viaScripts: false,
      viaCatalog: true,
      read: (file) => (existsSync(file) ? readFileSync(file, 'utf8') : undefined),
    });
    expect(declarationsOf(result)[0]!.displayPath).toBe(`build-logic/${CATALOG}`);
  });

  it('GRDCAT-14 A version accessor inside a string is resolved to the version entry', () => {
    const { result } = locate({
      [CATALOG]: '[versions]\nlib = "1.0"\n',
      'app/build.gradle': 'dependencies { implementation "org.example:lib:${libs.versions.lib.get()}" }',
    });
    expect(declarationsOf(result)[0]).toMatchObject({ kind: 'catalog', entry: 'versions.lib', displayPath: CATALOG });
  });

  it.each([
    ['retry = { id = "org.example.retry", version.ref = "retry" }', 'versions.retry'],
    ['retry = { id = "org.example.retry", version = "1.0" }', 'plugins.retry'],
    ['retry = "org.example.retry:1.0"', 'plugins.retry'],
  ])('GRDCAT-15 Plugin entries are located: %s', (entry, entryId) => {
    const catalog = `[versions]\nretry = "1.0"\n\n[plugins]\n${entry}\n`;
    const { root, result } = locate(
      { [CATALOG]: catalog, 'app/build.gradle': 'plugins { alias(libs.plugins.retry) }' },
      { group: 'org.example.retry', name: 'org.example.retry.gradle.plugin', isPlugin: true },
    );
    const [d] = declarationsOf(result);
    expect(d!.entry).toBe(entryId);
    // Only the text of the version changes, wherever it is written.
    const changed = applyTo([d!]).get(join(root, CATALOG))!;
    expect(changed.replace('1.1', '1.0')).toBe(catalog);
  });
});

describe('editing the catalog (GRDCAT-16, GRDCAT-17)', () => {
  const body =
    '# versions of the build\n[versions]\nlib   = "1.0"   # keep me\nother = "2.0"\n\n[libraries]\nlib = { module = "org.example:lib", version.ref = "lib" }';
  it.each([
    ['LF line endings', body.replaceAll('\n', '\n') + '\n'],
    ['CRLF line endings and a final line break', body.replaceAll('\n', '\r\n') + '\r\n'],
    ['a byte order mark and no final line break', '﻿' + body],
  ])('GRDCAT-16 Comments, spacing and order are untouched: %s', (_style, source) => {
    const { root, result } = locate({ [CATALOG]: source, ...usesLib }, { viaCatalog: true });
    expect(applyTo(declarationsOf(result)).get(join(root, CATALOG))).toBe(source.replace('1.0', '1.1'));
  });

  it('GRDCAT-17 A catalog that changed since the scan is not overwritten', () => {
    const { result } = locate({ [CATALOG]: '[libraries]\nlib = "org.example:lib:1.0"\n', ...usesLib }, { viaCatalog: true });
    const [d] = declarationsOf(result);
    const changed = '[libraries]\nlib = "org.example:lib:1.0.1"\n';
    expect(() => applyGradleEdits(changed, [{ ...d!.range, expected: '1.0', replacement: '1.1' }])).toThrow(StaleEditError);
  });

  it('The version range is found in quoted keys, literal strings and sections that follow other tables', () => {
    const source = "[versions]\n'quoted-key' = '1.0'\n\n[plugins]\nother = { id = \"x\", version = \"1.0\" }\n";
    const range = catalogVersionRange(source, 'versions.quoted-key');
    expect(source.slice(range!.start, range!.end)).toBe('1.0');
    expect(source.slice(catalogVersionRange(source, 'plugins.other')!.start).startsWith('1.0')).toBe(true);
    expect(catalogVersionRange(source, 'versions.missing')).toBeUndefined();
  });

  it('parseCatalog reads libraries, plugins and rich versions', () => {
    const catalog = parseCatalog(
      '[versions]\nv = { strictly = "1.0" }\n[libraries]\na = { module = "g:a", version.ref = "v" }\n[plugins]\np = { id = "x", version = "2.0" }\n',
    )!;
    expect(catalog.entries.map((e) => [e.section, e.key, e.versionEntry, e.version?.strictly ?? e.version?.require])).toEqual([
      ['libraries', 'a', 'versions.v', '1.0'],
      ['plugins', 'p', 'plugins.p', '2.0'],
    ]);
    expect(parseCatalog('[libraries\n')).toBeUndefined();
  });
});
