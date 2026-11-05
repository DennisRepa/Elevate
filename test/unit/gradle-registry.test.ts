import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeGradle, buildDoc, projectDoc, repo } from '../gradle-fake.js';
import { cleanupTemp, makeTree } from '../helpers.js';

const gradle = vi.hoisted(() => ({ fake: undefined as unknown as FakeGradle }));
vi.mock('../../src/adapters/shared/process.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/adapters/shared/process.js')>();
  return { ...actual, runCommand: (...args: Parameters<typeof actual.runCommand>) => gradle.fake.runCommand(...args) };
});

import { resetGradleCheck } from '../../src/adapters/gradle/gradle-command.js';
import { GradleRegistryAdapter } from '../../src/adapters/gradle/gradle-registry.js';
import { PublicLookupRefusedError, coordinateFromIdentifier, lookupVersions } from '../../src/application/version-lookup.js';
import type { EcosystemStrategy } from '../../src/domain/ecosystem-strategy.js';
import type { GradleRepositoryDocument } from '../../src/adapters/gradle/gradle-probe.js';

beforeEach(() => {
  gradle.fake = new FakeGradle();
  resetGradleCheck();
});
afterEach(cleanupTemp);

const registry = new GradleRegistryAdapter();

/** A repository root with one Gradle build whose root project declares the given repositories. */
function repository(repositories: GradleRepositoryDocument[] = [repo('MavenRepo')], config?: object): string {
  const root = makeTree({
    'settings.gradle': "rootProject.name = 'mono'",
    ...(config ? { 'elevate.config.json': JSON.stringify(config) } : {}),
  });
  gradle.fake.documents = [buildDoc('mono', root, [projectDoc(':', root, { repositories })])];
  return root;
}

const coordinate = (identifier: string) => coordinateFromIdentifier(identifier, 'gradle');

describe('single lookups (GRDVER-45 to GRDVER-48)', () => {
  it('GRDVER-45 The versions of a library, newest first', async () => {
    const root = repository();
    gradle.fake.lookups['org.example:lib'] = { versions: ['1.0', '1.2-rc1', '1.2', '1.1'] };
    expect(await registry.getAllVersions(coordinate('org.example:lib'), root)).toEqual(['1.2', '1.2-rc1', '1.1', '1.0']);
    expect(await registry.getLatestVersion(coordinate('org.example:lib'), 'stable', root)).toBe('1.2');
    gradle.fake.lookups['org.example:lib'] = { versions: ['1.0', '1.1', '2.0-rc1'] };
    expect(await registry.getLatestVersion(coordinate('org.example:lib'), 'stable', root)).toBe('1.1');
    expect(await registry.getLatestVersion(coordinate('org.example:lib'), 'all', root)).toBe('2.0-rc1');
  });

  it('GRDVER-46 A plugin id is looked up through the plugin repositories', async () => {
    const root = repository();
    gradle.fake.lookups['org.example.plugin:org.example.plugin.gradle.plugin'] = { versions: ['1.0', '1.1'] };
    expect(await registry.getLatestVersion(coordinate('org.example.plugin'), 'stable', root)).toBe('1.1');
    expect(gradle.fake.plans[0]!.lookups).toEqual([
      { id: 'L1', buildRoot: root, project: ':', kind: 'plugin', group: 'org.example.plugin', name: 'org.example.plugin.gradle.plugin' },
    ]);
  });

  it('GRDVER-47 An internal package is refused when only public repositories would be asked', async () => {
    const root = repository();
    const strategy = { registry } as unknown as EcosystemStrategy;
    const error = await lookupVersions(strategy, coordinate('com.acme:core'), { rootDir: root, internalScopes: ['com.acme'] }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(PublicLookupRefusedError);
    expect((error as Error).message).toBe(
      "'com.acme:core' is an internal package (internalScopes) and its lookup would go to the public registry https://repo.maven.apache.org/maven2/. Configure a private registry for it instead.",
    );
    expect(gradle.fake.lookupRuns).toHaveLength(0);
  });

  it('GRDVER-47 With a private repository the internal package is looked up, behind the guard', async () => {
    const root = repository([repo('MavenRepo'), repo('corp', 'https://nexus.acme.example/releases')], { internalScopes: ['com.acme'] });
    gradle.fake.lookups['com.acme:core'] = { versions: ['1.0', '1.1'] };
    const strategy = { registry } as unknown as EcosystemStrategy;
    expect(await lookupVersions(strategy, coordinate('com.acme:core'), { rootDir: root, internalScopes: ['com.acme'] })).toEqual(['1.1', '1.0']);
    expect(gradle.fake.plans[0]!.internalGroupPatterns).toEqual(['com\\.acme(\\..*)?']);
    expect(gradle.fake.plans[0]!.publicRepositoryUrls).toEqual(['https://repo.maven.apache.org/maven2']);
  });

  it('The endpoint is the first private repository, else the first public one', async () => {
    const root = repository([repo('MavenRepo'), repo('corp', 'https://deploy:s3cret@nexus.acme.example/releases')]);
    expect(await registry.resolveEndpoint(coordinate('org.example:lib'), root)).toEqual({ url: 'https://nexus.acme.example/releases', isPublic: false });
    const publicOnly = repository();
    expect(await registry.resolveEndpoint(coordinate('org.example:lib'), publicOnly)).toEqual({
      url: 'https://repo.maven.apache.org/maven2/',
      isPublic: true,
    });
  });

  it('GRDVER-48 A repository error is an error, never an empty list, and shows no credentials', async () => {
    const root = repository();
    gradle.fake.lookups['org.example:lib'] = {
      versions: [],
      error: "Could not resolve org.example:lib:+. > Could not GET 'https://deploy:s3cret@corp/lib/maven-metadata.xml'. Received status code 401 from server: Unauthorized",
    };
    const error = await registry.getAllVersions(coordinate('org.example:lib'), root).catch((e: unknown) => e);
    expect((error as Error).message).toBe("Could not GET 'https://corp/lib/maven-metadata.xml'. Received status code 401 from server: Unauthorized");
  });

  it('A build without repositories is an error', async () => {
    const root = repository([]);
    await expect(registry.getAllVersions(coordinate('org.example:lib'), root)).rejects.toThrow(
      'the build declares no repository for :',
    );
  });

  it('A coordinate without group or artifact has no versions and starts no run', async () => {
    expect(await registry.getAllVersions({ identifier: 'x', artifact: '', ecosystem: 'gradle' }, '/nowhere')).toEqual([]);
    expect(gradle.fake.runs).toHaveLength(0);
  });
});
