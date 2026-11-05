import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GradleModuleDiscoveryAdapter } from '../../src/adapters/gradle/gradle-discovery.js';
import { runLookup } from '../../src/adapters/gradle/gradle-probe.js';
import { GradleDependencyAdapter } from '../../src/adapters/gradle/gradle-scanner.js';
import type { LookupPlan } from '../../src/adapters/gradle/gradle-probe.js';
import type { ProjectModule, ReleaseChannel, ScanResult } from '../../src/domain/models.js';
import { cleanupTemp, copyFixture, makeTree, mavenMetadata, writeVersionRepository } from '../helpers.js';

afterEach(cleanupTemp);

const gradleInstalled = spawnSync('gradle', ['--version'], { encoding: 'utf8' }).status === 0;
const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

/** Scans `:app` of a tree with real Gradle. */
async function scanApp(root: string, internalScopes: string[] = [], channel: ReleaseChannel = 'stable'): Promise<{ module: ProjectModule; result: ScanResult }> {
  const modules = await new GradleModuleDiscoveryAdapter().discover(root);
  const module = modules.find((m) => m.id === ':app')!;
  const result = await new GradleDependencyAdapter().scan(module, { rootDir: root, workspace: new Map(), internalScopes, channel });
  return { module, result };
}

const appBuild = (repositories: string, dependency = "implementation 'org.example:lib:1.0'") =>
  `plugins { id 'java' }\nrepositories { ${repositories} }\ndependencies { ${dependency} }\n`;

/** A loopback HTTP server that serves `maven-metadata.xml` files and logs every request. */
async function repositoryServer(
  routes: Record<string, { status?: number; body?: string }>,
): Promise<{ url: string; requests: string[] }> {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const route = routes[req.url ?? ''];
    res.statusCode = route?.status ?? 404;
    res.end(route?.body ?? '');
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

describe.skipIf(!gradleInstalled)('Gradle scans and lookups with a real Gradle', () => {
  it('GRDVER-51 The versions of two repositories are merged', async () => {
    const root = makeTree({ 'settings.gradle': "include 'app'" });
    writeVersionRepository(join(root, 'repo-a'), { 'org.example:lib': ['1.0', '1.1', '1.2'] });
    writeVersionRepository(join(root, 'repo-b'), { 'org.example:lib': ['1.1', '1.3'] });
    const repositories = `maven { url = uri('${join(root, 'repo-a')}') }\n maven { url = uri('${join(root, 'repo-b')}') }`;
    mkdirSync(join(root, 'app'), { recursive: true });
    writeFileSync(join(root, 'app', 'build.gradle'), appBuild(repositories));

    const { result } = await scanApp(root);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ newRange: '1.3', availableVersions: ['1.3', '1.2', '1.1', '1.0'] });
    expect(result.candidates[0]!.declaration).toMatchObject({ kind: 'dependency', displayPath: 'app/build.gradle' });
    expect(result.skipped).toEqual([]);
  }, 300_000);

  it('GRDVER-52 A group the guard names never reaches a public repository, other groups still do', async () => {
    const pub = await repositoryServer({
      '/pub/com/acme/core/maven-metadata.xml': { status: 200, body: mavenMetadata('com.acme', 'core', ['99.0', '1.0']) },
      '/pub/org/example/lib/maven-metadata.xml': { status: 200, body: mavenMetadata('org.example', 'lib', ['1.0', '1.1']) },
    });
    const priv = await repositoryServer({
      '/priv/com/acme/core/maven-metadata.xml': { status: 200, body: mavenMetadata('com.acme', 'core', ['1.0', '1.1']) },
    });
    const root = makeTree({
      'settings.gradle': "rootProject.name = 'mono'",
      'build.gradle': `repositories {\n maven { url = uri('${priv.url}/priv'); allowInsecureProtocol = true }\n maven { url = uri('${pub.url}/pub'); allowInsecureProtocol = true }\n}\n`,
    });
    const plan: LookupPlan = {
      protocol: 1,
      publicRepositoryUrls: [`${pub.url}/pub`],
      internalGroupPatterns: ['com\\.acme(\\..*)?'],
      lookups: [
        { id: 'L1', buildRoot: root, project: ':', kind: 'module', group: 'com.acme', name: 'core' },
        { id: 'L2', buildRoot: root, project: ':', kind: 'module', group: 'org.example', name: 'lib' },
      ],
    };
    const results = await runLookup(root, root, plan);
    expect(results.find((r) => r.id === 'L1')).toMatchObject({ versions: ['1.1', '1.0'], error: null });
    expect(results.find((r) => r.id === 'L2')!.versions).toEqual(['1.1', '1.0']);
    expect(pub.requests.filter((r) => r.includes('/com/acme/'))).toEqual([]);
    expect(pub.requests.some((r) => r.includes('/org/example/lib/'))).toBe(true);
  }, 300_000);

  it('GRDVER-53 A repository error is a failed lookup, never an empty one', async () => {
    const server = await repositoryServer({
      '/r/org/example/a/maven-metadata.xml': { status: 401 },
    });
    const root = makeTree({
      'settings.gradle': "rootProject.name = 'mono'",
      'build.gradle': `repositories { maven { url = uri('${server.url}/r'); allowInsecureProtocol = true } }\n`,
    });
    const results = await runLookup(root, root, {
      protocol: 1,
      publicRepositoryUrls: [],
      internalGroupPatterns: [],
      lookups: [{ id: 'L1', buildRoot: root, project: ':', kind: 'module', group: 'org.example', name: 'a' }],
    });
    expect(results[0]!.versions).toEqual([]);
    expect(results[0]!.error).toContain('Received status code 401 from server');
  }, 300_000);

  it('GRDVER-54 A version published between two scans is seen by the second', async () => {
    const root = makeTree({ 'settings.gradle': "include 'app'" });
    const repo = join(root, 'repo');
    writeVersionRepository(repo, { 'org.example:lib': ['1.0', '1.1'] });
    mkdirSync(join(root, 'app'), { recursive: true });
    writeFileSync(join(root, 'app', 'build.gradle'), appBuild(`maven { url = uri('${repo}') }`));

    expect((await scanApp(root)).result.candidates[0]!.newRange).toBe('1.1');
    writeVersionRepository(repo, { 'org.example:lib': ['1.0', '1.1', '1.2'] });
    expect((await scanApp(root)).result.candidates[0]!.newRange).toBe('1.2');
  }, 300_000);

  it('GRDVER-55 A build with the configuration cache enabled is still scanned on every run', async () => {
    const root = makeTree({
      'settings.gradle': "include 'app'",
      'gradle.properties': 'org.gradle.configuration-cache=true\norg.gradle.unsafe.configuration-cache=true\n',
    });
    const repo = join(root, 'repo');
    writeVersionRepository(repo, { 'org.example:lib': ['1.0', '1.1'] });
    mkdirSync(join(root, 'app'), { recursive: true });
    writeFileSync(join(root, 'app', 'build.gradle'), appBuild(`maven { url = uri('${repo}') }`));

    expect((await scanApp(root)).result.candidates[0]!.newRange).toBe('1.1');
    expect((await scanApp(root)).result.candidates[0]!.newRange).toBe('1.1');
  }, 300_000);
  it('A scan covers the modules of the root build and of an included build, with one run each', async () => {
    const root = copyFixture('gradle-composite');
    const repo = join(root, 'repo');
    writeVersionRepository(repo, { 'org.example:lib': ['1.0', '1.1'] });
    const repositories = `\nrepositories { maven { url = uri('${repo}') } }\n`;
    appendFileSync(join(root, 'app', 'build.gradle'), repositories);
    appendFileSync(join(root, 'build-logic', 'build.gradle'), `${repositories}dependencies { implementation 'org.example:lib:1.0' }\n`);

    const modules = (await new GradleModuleDiscoveryAdapter().discover(root)).filter((m) => m.id === ':app' || m.id === ':build-logic');
    expect(modules.map((m) => m.id).sort()).toEqual([':app', ':build-logic']);
    const results = await new GradleDependencyAdapter().scanMany(modules, {
      rootDir: root,
      workspace: new Map(),
      internalScopes: [],
      channel: 'stable',
    });
    for (const module of modules) {
      const candidates = results.get(module)!.candidates;
      expect(candidates.map((c) => [c.coordinate.identifier, c.newRange]), module.id).toEqual([['org.example:lib', '1.1']]);
    }
    expect(results.get(modules.find((m) => m.id === ':build-logic')!)!.candidates[0]!.declaration!.displayPath).toBe('build-logic/build.gradle');
    // Nothing of Elevate is left in any build of the composite.
    expect(readdirSync(root, { recursive: true }).filter((e) => String(e).includes('elevate-'))).toEqual([]);
  }, 300_000);
});
