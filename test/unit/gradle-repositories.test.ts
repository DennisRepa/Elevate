import { describe, expect, it } from 'vitest';
import {
  PLUGIN_PORTAL,
  buildLookupPlan,
  effectiveRepositories,
  internalGroupPatterns,
  isPublicRepositoryUrl,
  normalizeRepositoryUrl,
  stripCredentials,
} from '../../src/adapters/gradle/gradle-repositories.js';
import type { LookupRequest } from '../../src/adapters/gradle/gradle-repositories.js';
import { buildDoc, projectDoc, repo } from '../gradle-fake.js';

const names = (repositories: { name: string }[]) => repositories.map((r) => r.name);

describe('effective repositories (GRDVER-14 to GRDVER-16)', () => {
  const S = [repo('S', 'https://s.example/')];
  const P = [repo('P', 'https://p.example/')];

  it.each([
    ['PREFER_PROJECT', S, P, ['P']],
    ['PREFER_PROJECT', S, [], ['S']],
    ['PREFER_PROJECT', [], P, ['P']],
    ['PREFER_SETTINGS', S, P, ['S']],
    ['PREFER_SETTINGS', [], P, []],
    ['FAIL_ON_PROJECT_REPOS', S, [], ['S']],
    [null, S, P, ['P']],
  ] as const)('GRDVER-14 mode %s, settings %j, project %j', (mode, settings, project, expected) => {
    const build = buildDoc('mono', '/r', [], { repositoriesMode: mode, settingsRepositories: [...settings] });
    const app = projectDoc(':app', '/r/app', { repositories: [...project] });
    expect(names(effectiveRepositories(build.build, app, 'module'))).toEqual(expected);
  });

  it('GRDVER-15 Plugin repositories are mapped from the plugin management of the settings', () => {
    const corp = repo('corp-plugins', 'https://nexus.acme.example/plugins');
    const build = buildDoc('mono', '/r', [], { pluginRepositories: [corp, PLUGIN_PORTAL] });
    const app = projectDoc(':app', '/r/app', {
      buildscriptRepositories: [
        repo('__plugin_repository__corp-plugins', null),
        repo('__plugin_repository__Gradle Central Plugin Repository', null),
      ],
    });
    expect(effectiveRepositories(build.build, app, 'plugin')).toEqual([corp, PLUGIN_PORTAL]);
  });

  it('GRDVER-16 A repository reported in the buildscript is used as it is', () => {
    const build = buildDoc('mono', '/r', []);
    const app = projectDoc(':app', '/r/app', { buildscriptRepositories: [PLUGIN_PORTAL] });
    expect(effectiveRepositories(build.build, app, 'plugin')).toEqual([PLUGIN_PORTAL]);
  });

  it('GRDVER-16 Without plugin repositories the Gradle Plugin Portal is used', () => {
    const build = buildDoc('mono', '/r', []);
    expect(effectiveRepositories(build.build, projectDoc(':app', '/r/app'), 'plugin')).toEqual([PLUGIN_PORTAL]);
    const unmatched = projectDoc(':app', '/r/app', { buildscriptRepositories: [repo('__plugin_repository__gone', null)] });
    expect(effectiveRepositories(build.build, unmatched, 'plugin')).toEqual([PLUGIN_PORTAL]);
  });
});

describe('public repositories (GRDVER-17, GRDVER-18)', () => {
  it.each([
    ['https://repo.maven.apache.org/maven2/', true],
    ['https://repo1.maven.org/maven2', true],
    ['https://dl.google.com/dl/android/maven2/', true],
    ['https://plugins.gradle.org/m2', true],
    ['https://jitpack.io', true],
    ['https://REPO.MAVEN.APACHE.ORG/maven2', true],
    ['https://deploy:s3cret@repo.maven.apache.org/maven2/', true],
    ['https://nexus.acme.example/repository/maven-central/', false],
    ['http://127.0.0.1:8081/repository/releases', false],
    ['file:/root/.m2/repository', false],
    [null, false],
    ['not a url', false],
  ])('GRDVER-17 %s is public: %s', (url, expected) => {
    expect(isPublicRepositoryUrl(url)).toBe(expected);
  });

  it('GRDVER-18 Credentials and trailing slashes are removed', () => {
    expect(normalizeRepositoryUrl('https://deploy:s3cret@repo.maven.apache.org/maven2/')).toBe(
      'https://repo.maven.apache.org/maven2',
    );
    expect(stripCredentials("Could not GET 'https://deploy:s3cret@corp/a'. Received status code 401")).toBe(
      "Could not GET 'https://corp/a'. Received status code 401",
    );
  });
});

describe('internal group patterns (GRDVER-19)', () => {
  it.each([
    ['com.acme', ['com\\.acme(\\..*)?']],
    ['com.acme.', ['com\\.acme(\\..*)?']],
    ['@my-org', ['my-org(\\..*)?']],
    ['io.github.me', ['io\\.github\\.me(\\..*)?']],
    ['@', []],
  ])('scope "%s"', (scope, patterns) => {
    expect(internalGroupPatterns([scope])).toEqual(patterns);
  });

  it('The patterns match the group and its subgroups only', () => {
    const [pattern] = internalGroupPatterns(['com.acme']);
    const matches = (group: string) => new RegExp(`^(?:${pattern})$`).test(group);
    expect(matches('com.acme')).toBe(true);
    expect(matches('com.acme.billing')).toBe(true);
    expect(matches('com.acmecorp')).toBe(false);
    expect(matches('xcom.acme')).toBe(false);
  });

  it('Duplicate scopes give one pattern', () => {
    expect(internalGroupPatterns(['com.acme', 'com.acme.', '@com.acme'])).toHaveLength(1);
  });
});

describe('the lookup plan (GRDVER-20, GRDVER-33, GRDVER-35, GRDVER-36)', () => {
  const central = [repo('MavenRepo', 'https://repo.maven.apache.org/maven2/')];
  const request = (project: string, name: string, repositories = central, buildRoot = '/r'): LookupRequest => ({
    buildRoot, project, kind: 'module', group: 'org.example', name, repositories,
  });

  it('GRDVER-33 The plan names every coordinate with the project that decides its repositories', () => {
    const { plan } = buildLookupPlan([request(':app', 'a'), request(':app', 'b')], []);
    expect(plan).toEqual({
      protocol: 1,
      publicRepositoryUrls: ['https://repo.maven.apache.org/maven2'],
      internalGroupPatterns: [],
      lookups: [
        { id: 'L1', buildRoot: '/r', project: ':app', kind: 'module', group: 'org.example', name: 'a' },
        { id: 'L2', buildRoot: '/r', project: ':app', kind: 'module', group: 'org.example', name: 'b' },
      ],
    });
  });

  it('GRDVER-35 Projects with the same repositories share one lookup', () => {
    const built = buildLookupPlan([request(':', 'a'), request(':app', 'a')], []);
    expect(built.plan.lookups).toHaveLength(1);
    expect(built.plan.lookups[0]!.project).toBe(':');
    expect(built.idOf(request(':app', 'a'))).toBe('L1');
  });

  it('GRDVER-36 Projects with different repositories look up the same coordinate separately', () => {
    const corp = [repo('corp', 'https://nexus.acme.example/releases')];
    const built = buildLookupPlan([request(':', 'a', corp), request(':app', 'a')], []);
    expect(built.plan.lookups.map((l) => [l.id, l.project])).toEqual([['L1', ':'], ['L2', ':app']]);
    expect(built.plan.publicRepositoryUrls).toEqual(['https://repo.maven.apache.org/maven2']);
  });

  it('Builds do not share lookups', () => {
    const built = buildLookupPlan([request(':', 'a', central, '/r'), request(':', 'a', central, '/r/included')], []);
    expect(built.plan.lookups).toHaveLength(2);
  });

  it('GRDVER-18 The plan holds no credentials', () => {
    const secret = [repo('corp', 'https://deploy:s3cret@repo.maven.apache.org/maven2/')];
    const { plan } = buildLookupPlan([request(':app', 'a', secret)], []);
    expect(JSON.stringify(plan)).not.toContain('s3cret');
    expect(plan.publicRepositoryUrls).toEqual(['https://repo.maven.apache.org/maven2']);
  });

  it('GRDVER-21 A public URL used by several projects is listed once; private ones are not listed', () => {
    const corp = repo('corp', 'https://nexus.acme.example/releases');
    const { plan } = buildLookupPlan([request(':', 'a', [corp, ...central]), request(':app', 'b', [corp, ...central])], ['com.acme']);
    expect(plan.publicRepositoryUrls).toEqual(['https://repo.maven.apache.org/maven2']);
    expect(plan.internalGroupPatterns).toEqual(['com\\.acme(\\..*)?']);
  });
});
