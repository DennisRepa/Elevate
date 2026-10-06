import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MavenDependencyAdapter } from '../../src/adapters/maven/maven-scanner.js';
import { MavenModuleDiscoveryAdapter } from '../../src/adapters/maven/maven-discovery.js';
import { createScanContext } from '../../src/application/scan.js';
import type { ReleaseChannel } from '../../src/domain/models.js';
import { FakeMaven, effectivePom } from '../maven-fake.js';
import { cleanupTemp, makeTree, pom } from '../helpers.js';

// Maven itself is replaced by a test double.
const mocks = vi.hoisted(() => ({ runMaven: vi.fn() }));
vi.mock('../../src/adapters/maven/maven-command.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/adapters/maven/maven-command.js')>()),
  runMaven: mocks.runMaven,
}));

let maven: FakeMaven;
beforeEach(() => {
  maven = new FakeMaven();
  mocks.runMaven.mockImplementation(maven.run);
});
afterEach(cleanupTemp);

const modules = (...names: string[]) => `<modules>${names.map((n) => `<module>${n}</module>`).join('')}</modules>`;
const aggregator = (g: string, a: string, v: string, ...names: string[]) =>
  `<groupId>${g}</groupId><artifactId>${a}</artifactId><version>${v}</version><packaging>pom</packaging>${modules(...names)}`;
const child = (g: string, a: string, v: string, artifactId: string, dependencies = '') =>
  `<parent><groupId>${g}</groupId><artifactId>${a}</artifactId><version>${v}</version></parent><artifactId>${artifactId}</artifactId>` +
  (dependencies ? `<dependencies>${dependencies}</dependencies>` : '');
const dependency = (g: string, a: string, v: string) =>
  `<dependency><groupId>${g}</groupId><artifactId>${a}</artifactId><version>${v}</version></dependency>`;

/** The tree of ALIGN-01, with the version "app" declares for com.acme:core. */
function reactorTree(declared: string): Record<string, string> {
  return {
    'pom.xml': pom(aggregator('com.acme', 'parent', '2.0.0', 'core', 'app')),
    'core/pom.xml': pom(child('com.acme', 'parent', '2.0.0', 'core')),
    'app/pom.xml': pom(child('com.acme', 'parent', '2.0.0', 'app', dependency('com.acme', 'core', declared))),
  };
}

/** The tree of ALIGN-03: com.acme:core lives in another reactor than "apps/shop". */
function twoReactorTree(): Record<string, string> {
  return {
    'libs/pom.xml': pom(aggregator('com.acme', 'libs', '3.0.0', 'core')),
    'libs/core/pom.xml': pom(child('com.acme', 'libs', '3.0.0', 'core')),
    'apps/pom.xml': pom(aggregator('com.acme', 'apps', '1.0.0', 'shop')),
    'apps/shop/pom.xml': pom(child('com.acme', 'apps', '1.0.0', 'shop', dependency('com.acme', 'core', '2.1.0'))),
  };
}

async function scan(
  files: Record<string, string>,
  relPath: string,
  options: { dependencies: { groupId: string; artifactId: string; version: string }[]; newer?: Record<string, string[]>; internalScopes?: string[]; channel?: ReleaseChannel },
) {
  const root = makeTree(files);
  maven.answers = { effectivePom: effectivePom(options.dependencies), newerVersions: options.newer ?? {} };
  const found = await new MavenModuleDiscoveryAdapter().discover(root);
  const module = found.find((m) => m.relPath === relPath)!;
  const context = createScanContext(found, { rootDir: root, internalScopes: options.internalScopes ?? [] }, options.channel ?? 'stable');
  return new MavenDependencyAdapter().scan(module, context);
}

const core = (version: string) => ({ groupId: 'com.acme', artifactId: 'core', version });
const forCore = (result: Awaited<ReturnType<typeof scan>>) =>
  result.candidates.filter((c) => c.coordinate.identifier === 'com.acme:core');

describe('reactor-scoped alignment', () => {
  it('ALIGN-01 A dependency on a reactor module with another version is offered for alignment', async () => {
    const result = await scan(reactorTree('1.0.0'), 'app', {
      dependencies: [core('1.0.0')],
      newer: { 'com.acme:core': ['1.5.0'] },
    });
    const offered = forCore(result);
    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatchObject({ action: 'align', latest: '2.0.0', newRange: '2.0.0', availableVersions: ['2.0.0'] });
    expect(offered[0]!.origin.kind).toBe('workspace');
    expect(maven.lookedUp).not.toContain('com.acme:core');
  });

  it('ALIGN-02 A dependency that already matches the reactor module is left alone', async () => {
    const result = await scan(reactorTree('2.0.0'), 'app', {
      dependencies: [core('2.0.0')],
      newer: { 'com.acme:core': ['1.5.0'] },
    });
    expect(forCore(result)).toHaveLength(0);
    expect(result.skipped.map((s) => s.identifier)).not.toContain('com.acme:core');
    expect(maven.lookedUp).not.toContain('com.acme:core');
  });

  it('ALIGN-03 A project of another reactor in the same repository is looked up, not aligned', async () => {
    const result = await scan(twoReactorTree(), 'apps/shop', {
      dependencies: [core('2.1.0')],
      newer: { 'com.acme:core': ['2.2.0'] },
    });
    const offered = forCore(result);
    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatchObject({ action: 'update', latest: '2.2.0' });
    expect(offered[0]!.origin.kind).toBe('public');
    expect(maven.lookedUp).toContain('com.acme:core');
  });

  it('ALIGN-04 A stray POM with the coordinates of a public artifact does not cause a downgrade', async () => {
    const files = {
      'pom.xml': pom(aggregator('org.example', 'parent', '1.0.0', 'app')),
      'app/pom.xml': pom(child('org.example', 'parent', '1.0.0', 'app', dependency('com.google.guava', 'guava', '33.0.0-jre'))),
      'examples/legacy/pom.xml': pom('<groupId>com.google.guava</groupId><artifactId>guava</artifactId><version>1.0</version>'),
    };
    const result = await scan(files, 'app', {
      dependencies: [{ groupId: 'com.google.guava', artifactId: 'guava', version: '33.0.0-jre' }],
      newer: { 'com.google.guava:guava': ['33.1.0-jre', '33.2.0-jre'] },
    });
    const offered = result.candidates.filter((c) => c.coordinate.identifier === 'com.google.guava:guava');
    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatchObject({ action: 'update', latest: '33.2.0-jre' });
    expect(offered[0]!.origin.kind).toBe('public');
    expect(result.candidates.map((c) => c.latest)).not.toContain('1.0');
  });

  it('ALIGN-05 Independent projects without an aggregator are not aligned to each other', async () => {
    const files = {
      'lib/pom.xml': pom('<groupId>com.acme</groupId><artifactId>lib</artifactId><version>5.0.0</version>'),
      'app/pom.xml': pom(
        '<groupId>com.acme</groupId><artifactId>app</artifactId><version>1.0.0</version>' +
          `<dependencies>${dependency('com.acme', 'lib', '4.0.0')}</dependencies>`,
      ),
    };
    const result = await scan(files, 'app', {
      dependencies: [{ groupId: 'com.acme', artifactId: 'lib', version: '4.0.0' }],
      newer: { 'com.acme:lib': ['4.1.0'] },
    });
    const offered = result.candidates.filter((c) => c.coordinate.identifier === 'com.acme:lib');
    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatchObject({ action: 'update', latest: '4.1.0' });
  });

  it('ALIGN-06 An internal scope still marks such a dependency as private', async () => {
    const result = await scan(twoReactorTree(), 'apps/shop', {
      dependencies: [core('2.1.0')],
      newer: { 'com.acme:core': ['2.2.0'] },
      internalScopes: ['com.acme'],
    });
    const offered = forCore(result);
    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatchObject({ action: 'update' });
    expect(offered[0]!.origin.kind).toBe('private');
  });

  it('ALIGN-07 Nothing is offered when the repositories know no newer version', async () => {
    const result = await scan(twoReactorTree(), 'apps/shop', { dependencies: [core('2.1.0')], newer: {} });
    expect(forCore(result)).toHaveLength(0);
    expect(result.candidates.map((c) => c.latest)).not.toContain('3.0.0');
  });
});
