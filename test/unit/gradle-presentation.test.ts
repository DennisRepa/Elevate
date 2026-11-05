import { describe, expect, it } from 'vitest';
import { describeSkip } from '../../src/application/describe.js';
import { candidateToJson } from '../../src/application/scan.js';
import type { UpdateCandidate, VersionDeclaration } from '../../src/domain/models.js';
import { getTranslations } from '../../src/i18n/index.js';

const declaration = (over: Partial<VersionDeclaration>): VersionDeclaration => ({
  file: '/r/app/build.gradle',
  kind: 'dependency',
  displayPath: 'app/build.gradle',
  ...over,
});

const candidate = (declarations: VersionDeclaration[]): UpdateCandidate => ({
  coordinate: { identifier: 'org.example:lib', group: 'org.example', artifact: 'lib', ecosystem: 'gradle' },
  currentRange: '1.0',
  currentClean: '1.0',
  latest: '1.1',
  newRange: '1.1',
  diff: 'minor',
  scope: 'prod',
  selected: true,
  origin: { kind: 'public' },
  action: 'update',
  declaration: declarations[0],
  declarations,
});

describe('what a candidate says about where its version is written', () => {
  it.each([
    ['in the build script of ":app"', declaration({}), { file: 'app/build.gradle', kind: 'dependency' }],
    [
      'in a constraint of the build script of ":app"',
      declaration({ kind: 'dependency-management' }),
      { file: 'app/build.gradle', kind: 'dependency-management' },
    ],
    [
      'in the property jacksonVersion of gradle.properties',
      declaration({ kind: 'property', propertyName: 'jacksonVersion', displayPath: 'gradle.properties' }),
      { file: 'gradle.properties', kind: 'property', property: 'jacksonVersion' },
    ],
    ['in the plugins block of the build script of ":app"', declaration({ kind: 'plugin' }), { file: 'app/build.gradle', kind: 'plugin' }],
    [
      'in the version "guava" of the catalog "libs"',
      declaration({ kind: 'catalog', catalogName: 'libs', entry: 'versions.guava', displayPath: 'gradle/libs.versions.toml' }),
      { file: 'gradle/libs.versions.toml', kind: 'catalog', catalog: 'libs', entry: 'versions.guava' },
    ],
  ])('GRDDEC-37 declaredIn is named %s', (_where, d, expected) => {
    expect(JSON.parse(JSON.stringify(candidateToJson(candidate([d])).declaredIn))).toEqual(expected);
  });

  it('GRDDEC-38 A candidate with several locations lists the others', () => {
    const json = JSON.parse(
      JSON.stringify(candidateToJson(candidate([declaration({}), declaration({ kind: 'dependency-management' })]))),
    );
    expect(json.declaredIn).toEqual({ file: 'app/build.gradle', kind: 'dependency' });
    expect(json.alsoDeclaredIn).toEqual([{ file: 'app/build.gradle', kind: 'dependency-management' }]);
  });

  it('A candidate with one location has no alsoDeclaredIn', () => {
    expect(candidateToJson(candidate([declaration({})])).alsoDeclaredIn).toBeUndefined();
  });
});

describe('the reason "version-constraint" (GRDDEC-40)', () => {
  const skipped = {
    identifier: 'org.example:lib',
    origin: 'public' as const,
    reason: 'version-constraint' as const,
    detail: "dynamic version '1.+'",
  };

  it('is described for the command line and the MCP server', () => {
    expect(describeSkip(skipped)).toBe("version is a selector or constraint, not a plain version (dynamic version '1.+')");
  });

  it('is labelled in English and German for the dashboard', () => {
    expect(getTranslations('en').list.skipReason('version-constraint')).toBe('version is a selector or constraint, not a plain version');
    expect(getTranslations('de').list.skipReason('version-constraint')).toBe(
      'Version ist ein Selektor oder eine Einschränkung, keine feste Version',
    );
  });
});
