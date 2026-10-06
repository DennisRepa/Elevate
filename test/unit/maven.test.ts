import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MavenModuleDiscoveryAdapter } from '../../src/adapters/maven/maven-discovery.js';
import { MavenProject } from '../../src/adapters/maven/maven-project.js';
import { locateDependencyVersion, locateParentVersion } from '../../src/adapters/maven/maven-locator.js';
import {
  buildProbePom,
  parseEffectivePom,
  parseFailedLookups,
  parseUpdatesReport,
} from '../../src/adapters/maven/maven-resolution.js';
import { MavenUpdaterAdapter } from '../../src/adapters/maven/maven-updater.js';
import { newerThan } from '../../src/adapters/maven/maven-scanner.js';
import { planBuild } from '../../src/adapters/maven/maven-verifier.js';
import { findMavenWrapper } from '../../src/adapters/maven/maven-command.js';
import { InstallError } from '../../src/domain/ports.js';
import type { ProjectModule, UpdateCandidate, VersionDeclaration } from '../../src/domain/models.js';
import { FIXTURES, cleanupTemp, copyFixture, makeTree, pom } from '../helpers.js';

afterEach(cleanupTemp);

const REACTOR = join(FIXTURES, 'maven-reactor');

describe('MavenModuleDiscoveryAdapter', () => {
  it('includes the root POM and resolves inherited coordinates and the reactor', async () => {
    const modules = await new MavenModuleDiscoveryAdapter().discover(REACTOR);
    expect(modules.map((m) => [m.id, m.relPath, m.version, m.isRoot, m.aggregatorDir])).toEqual([
      ['com.acme:acme-parent', 'Root', '1.1.0-SNAPSHOT', true, REACTOR],
      ['com.acme:acme-app', 'app', '1.1.0-SNAPSHOT', false, REACTOR],
      ['com.acme:acme-core', 'core', '1.1.0-SNAPSHOT', false, REACTOR],
    ]);
  });

  it('resolves CI-friendly ${revision} versions from the parent', async () => {
    const root = makeTree({
      'pom.xml': pom(
        '<groupId>g</groupId><artifactId>parent</artifactId><version>${revision}</version><packaging>pom</packaging>' +
          '<properties><revision>4.2.0</revision></properties><modules><module>lib</module></modules>',
      ),
      'lib/pom.xml': pom(
        '<parent><groupId>g</groupId><artifactId>parent</artifactId><version>${revision}</version></parent><artifactId>lib</artifactId>',
      ),
    });
    const modules = await new MavenModuleDiscoveryAdapter().discover(root);
    expect(modules.find((m) => m.id === 'g:lib')?.version).toBe('4.2.0');
  });

  it('follows <modules> into directories the file walk skips', async () => {
    const root = makeTree({
      'pom.xml': pom(
        '<groupId>g</groupId><artifactId>parent</artifactId><version>1</version><packaging>pom</packaging><modules><module>build</module></modules>',
      ),
      'build/pom.xml': pom('<groupId>g</groupId><artifactId>build-tools</artifactId><version>1</version>'),
    });
    const modules = await new MavenModuleDiscoveryAdapter().discover(root);
    expect(modules.map((m) => m.id)).toContain('g:build-tools');
  });

  it('reports independent projects without an aggregator', async () => {
    const root = makeTree({ 'service/pom.xml': pom('<groupId>g</groupId><artifactId>svc</artifactId><version>1</version>') });
    const [svc] = await new MavenModuleDiscoveryAdapter().discover(root);
    expect(svc).toMatchObject({ id: 'g:svc', relPath: 'service', aggregatorDir: undefined });
  });
});

describe('locateDependencyVersion', () => {
  const project = MavenProject.load(REACTOR);
  const chainOf = (dir: string) => project.chainOf(project.pomAt(join(REACTOR, dir, 'pom.xml'))!).poms;

  it('follows a property reference to the parent POM', () => {
    const lookup = locateDependencyVersion(
      chainOf('core'),
      { groupId: 'org.apache.commons', artifactId: 'commons-lang3', effectiveVersion: '3.12.0' },
      REACTOR,
    );
    expect(lookup).toMatchObject({
      found: true,
      value: '3.12.0',
      declaration: { kind: 'property', propertyName: 'commons-lang3.version', displayPath: 'pom.xml' },
    });
  });

  it('finds managed versions in the parent for dependencies without a version', () => {
    const lookup = locateDependencyVersion(
      chainOf('app'),
      { groupId: 'com.google.guava', artifactId: 'guava', effectiveVersion: '32.0.0-jre' },
      REACTOR,
    );
    expect(lookup).toMatchObject({ found: true, declaration: { kind: 'dependency-management', displayPath: 'pom.xml' } });
  });

  it('finds an explicit version in the module itself', () => {
    const lookup = locateDependencyVersion(
      chainOf('app'),
      { groupId: 'com.acme', artifactId: 'acme-core', effectiveVersion: '1.0.0' },
      REACTOR,
    );
    expect(lookup).toMatchObject({ found: true, declaration: { kind: 'dependency', displayPath: 'app/pom.xml' } });
  });

  it('reports a mismatch instead of guessing when Maven resolves something else', () => {
    const lookup = locateDependencyVersion(
      chainOf('app'),
      { groupId: 'com.acme', artifactId: 'acme-core', effectiveVersion: '2.0.0' },
      REACTOR,
    );
    expect(lookup).toMatchObject({ found: false, reason: 'declaration-mismatch' });
  });

  it('reports versions managed outside the repository', () => {
    const lookup = locateDependencyVersion(
      chainOf('app'),
      { groupId: 'org.slf4j', artifactId: 'slf4j-api', effectiveVersion: '2.0.0' },
      REACTOR,
    );
    expect(lookup).toMatchObject({ found: false, reason: 'managed-externally' });
  });

  it('lets a child property override the parent, as Maven does', () => {
    const root = makeTree({
      'pom.xml': pom(
        '<groupId>g</groupId><artifactId>parent</artifactId><version>1</version><packaging>pom</packaging>' +
          '<properties><x.version>1.0</x.version></properties>' +
          '<dependencies><dependency><groupId>x</groupId><artifactId>x</artifactId><version>${x.version}</version></dependency></dependencies>',
      ),
      'child/pom.xml': pom(
        '<parent><groupId>g</groupId><artifactId>parent</artifactId><version>1</version></parent><artifactId>child</artifactId>' +
          '<properties><x.version>2.0</x.version></properties>',
      ),
    });
    const project = MavenProject.load(root);
    const chain = project.chainOf(project.pomAt(join(root, 'child', 'pom.xml'))!).poms;
    const lookup = locateDependencyVersion(chain, { groupId: 'x', artifactId: 'x', effectiveVersion: '2.0' }, root);
    expect(lookup).toMatchObject({ found: true, declaration: { kind: 'property', displayPath: 'child/pom.xml' } });
  });
});

describe('locateParentVersion', () => {
  it('locates the version of an external parent', () => {
    const root = makeTree({
      'pom.xml': pom(
        '<parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>3.2.0</version></parent><artifactId>app</artifactId>',
      ),
    });
    const project = MavenProject.load(root);
    const app = project.pomAt(join(root, 'pom.xml'))!;
    expect(project.chainOf(app).externalParent?.artifactId).toBe('spring-boot-starter-parent');
    const lookup = locateParentVersion(
      app,
      { groupId: 'org.springframework.boot', artifactId: 'spring-boot-starter-parent', effectiveVersion: '3.2.0' },
      root,
    );
    expect(lookup).toMatchObject({ found: true, declaration: { kind: 'parent' } });
  });
});

describe('Maven tool output parsing', () => {
  it('reads dependencies and management from an effective POM', () => {
    const model = parseEffectivePom(
      pom(
        '<dependencyManagement><dependencies><dependency><groupId>a</groupId><artifactId>b</artifactId><version>1</version></dependency></dependencies></dependencyManagement>' +
          '<dependencies><dependency><groupId>c</groupId><artifactId>d</artifactId><version>2</version><scope>test</scope></dependency></dependencies>' +
          '<repositories><repository><id>nexus</id><url>https://nexus.corp/maven</url></repository></repositories>',
      ),
    );
    expect(model.dependencies).toEqual([{ groupId: 'c', artifactId: 'd', version: '2', scope: 'test', type: 'jar', classifier: undefined }]);
    expect(model.managedDependencies[0]).toMatchObject({ groupId: 'a', version: '1', scope: 'compile' });

    const probe = buildProbePom([{ groupId: 'c', artifactId: 'd', version: '2' }], model);
    expect(probe).toContain('<url>https://nexus.corp/maven</url>');
    expect(probe).toContain('<dependency><groupId>c</groupId><artifactId>d</artifactId><version>2</version></dependency>');
    expect(probe).not.toContain('<artifactId>b</artifactId>');
  });

  it('collects newer versions from the versions-maven-plugin XML report in ascending order', () => {
    const report = `<?xml version='1.0' encoding='UTF-8'?>
<DependencyUpdatesReport xmlns="https://www.mojohaus.org/VERSIONS/DEPENDENCY-UPDATES-REPORT/2.0.0">
  <dependencyManagements>
    <dependencyManagement>
      <groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId>
      <currentVersion>5.9.0</currentVersion>
      <incrementals><incremental>5.9.1</incremental></incrementals>
      <minors><minor>5.10.0-M1</minor><minor>5.10.0</minor></minors>
      <majors><major>6.0.0</major></majors>
    </dependencyManagement>
    <dependencyManagement>
      <groupId>org.apache.commons</groupId><artifactId>commons-lang3</artifactId>
      <currentVersion>3.12.0</currentVersion><status>no new available</status>
    </dependencyManagement>
  </dependencyManagements>
</DependencyUpdatesReport>`;
    const versions = parseUpdatesReport(report);
    expect(versions.get('org.junit.jupiter:junit-jupiter')).toEqual(['5.9.1', '5.10.0-M1', '5.10.0', '6.0.0']);
    expect(versions.get('org.apache.commons:commons-lang3')).toEqual([]);
  });

  it('detects lookups the plugin silently downgraded to warnings', () => {
    const log =
      '[WARNING] Could not transfer metadata org.apache.commons:commons-lang3/maven-metadata.xml from/to nexus (http://nexus): status code: 500\n' +
      '[INFO] BUILD SUCCESS';
    expect([...parseFailedLookups(log)]).toEqual(['org.apache.commons:commons-lang3']);
  });
});

describe('newerThan', () => {
  it("keeps only versions after the module's own version in a shared report", () => {
    expect(newerThan('1.2', ['1.1', '1.2', '1.3'])).toEqual(['1.3']);
    expect(newerThan('1.0', ['1.1', '1.2'])).toEqual(['1.1', '1.2']);
  });
});

describe('MavenUpdaterAdapter', () => {
  const module = (root: string, dir: string): ProjectModule => ({
    id: 'x',
    name: 'x',
    path: join(root, dir),
    relPath: dir,
    ecosystem: 'maven',
    isRoot: false,
  });

  const candidate = (
    root: string,
    identifier: string,
    current: string,
    target: string,
    declaration: Omit<VersionDeclaration, 'file'> & { file: string },
  ): UpdateCandidate => {
    const [group, artifact] = identifier.split(':');
    return {
      coordinate: { identifier, group, artifact: artifact!, ecosystem: 'maven' },
      currentRange: current,
      currentClean: current,
      latest: target,
      newRange: target,
      diff: 'minor',
      scope: 'prod',
      selected: true,
      origin: { kind: 'public' },
      action: 'update',
      declaration: { ...declaration, file: join(root, declaration.file) },
    };
  };

  it('edits declarations in several files and keeps formatting and comments', async () => {
    const root = copyFixture('maven-reactor');
    const before = readFileSync(join(root, 'core', 'pom.xml'), 'utf8');
    const updates = [
      candidate(root, 'org.apache.commons:commons-lang3', '3.12.0', '3.14.0', {
        file: 'pom.xml',
        kind: 'property',
        propertyName: 'commons-lang3.version',
        displayPath: 'pom.xml',
      }),
      candidate(root, 'org.junit.jupiter:junit-jupiter', '5.9.0', '5.10.0', {
        file: 'core/pom.xml',
        kind: 'dependency',
        displayPath: 'core/pom.xml',
      }),
    ];

    const outcome = await new MavenUpdaterAdapter().applyUpdates(module(root, 'core'), root, updates, () => {});
    expect(outcome.updatedCount).toBe(2);

    const rootPom = readFileSync(join(root, 'pom.xml'), 'utf8');
    expect(rootPom).toContain('<commons-lang3.version>3.14.0</commons-lang3.version>');
    const corePom = readFileSync(join(root, 'core', 'pom.xml'), 'utf8');
    expect(corePom).toBe(before.replace('<version>5.9.0</version>', '<version>5.10.0</version>'));
    // The commented-out dependency is untouched.
    expect(corePom).toContain('<version>1.0</version>');
  });

  it('refuses edits based on an outdated scan and writes nothing', async () => {
    const root = copyFixture('maven-reactor');
    const original = readFileSync(join(root, 'pom.xml'), 'utf8');
    const updates = [
      candidate(root, 'com.google.guava:guava', '32.0.0-jre', '33.0.0-jre', {
        file: 'pom.xml',
        kind: 'dependency-management',
        displayPath: 'pom.xml',
      }),
      candidate(root, 'org.junit.jupiter:junit-jupiter', '5.8.0', '5.10.0', {
        file: 'core/pom.xml',
        kind: 'dependency',
        displayPath: 'core/pom.xml',
      }),
    ];
    await expect(new MavenUpdaterAdapter().applyUpdates(module(root, 'core'), root, updates, () => {})).rejects.toThrow(
      InstallError,
    );
    expect(readFileSync(join(root, 'pom.xml'), 'utf8')).toBe(original);
  });

  it('rejects conflicting targets for a shared property', async () => {
    const root = copyFixture('maven-reactor');
    const property = { file: 'pom.xml', kind: 'property' as const, propertyName: 'commons-lang3.version', displayPath: 'pom.xml' };
    const updates = [
      candidate(root, 'org.apache.commons:commons-lang3', '3.12.0', '3.14.0', property),
      { ...candidate(root, 'org.apache.commons:commons-lang3', '3.12.0', '3.15.0', property), coordinate: { identifier: 'org.apache.commons:commons-other', group: 'org.apache.commons', artifact: 'commons-other', ecosystem: 'maven' as const } },
    ];
    await expect(new MavenUpdaterAdapter().applyUpdates(module(root, 'core'), root, updates, () => {})).rejects.toThrow(
      /share .* but target different versions/,
    );
  });

  it('lists every declaring file as affected', () => {
    const root = copyFixture('maven-reactor');
    const files = new MavenUpdaterAdapter().affectedFiles(module(root, 'app'), root, [
      candidate(root, 'com.google.guava:guava', '32.0.0-jre', '33.0.0-jre', {
        file: 'pom.xml',
        kind: 'dependency-management',
        displayPath: 'pom.xml',
      }),
    ]);
    expect(files).toEqual([join(root, 'pom.xml')]);
  });
});

describe('planBuild', () => {
  const modules = new MavenModuleDiscoveryAdapter();

  it('builds changed modules and their dependents within the reactor', async () => {
    const all = await modules.discover(REACTOR);
    const core = all.find((m) => m.relPath === 'core')!;
    expect(planBuild(core, REACTOR, [join(REACTOR, 'core', 'pom.xml')])).toEqual({
      cwd: REACTOR,
      args: ['-pl', 'core', '-amd'],
    });
  });

  it('builds the whole reactor when the aggregator POM changed', async () => {
    const all = await modules.discover(REACTOR);
    const app = all.find((m) => m.relPath === 'app')!;
    expect(planBuild(app, REACTOR, [join(REACTOR, 'pom.xml'), join(REACTOR, 'app', 'pom.xml')])).toEqual({
      cwd: REACTOR,
      args: [],
    });
  });

  it('builds standalone projects in their own directory', () => {
    const standalone: ProjectModule = { id: 'g:a', name: 'a', path: '/repo/a', relPath: 'a', ecosystem: 'maven', isRoot: false };
    expect(planBuild(standalone, '/repo', [])).toEqual({ cwd: '/repo/a', args: [] });
  });
});

describe('findMavenWrapper', () => {
  it('finds the nearest wrapper but never searches above the repository root', () => {
    const wrapper = process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw';
    const root = makeTree({ [`repo/${wrapper}`]: '', 'repo/module/pom.xml': '', [`${wrapper}`]: '' });
    expect(findMavenWrapper(join(root, 'repo', 'module'), join(root, 'repo'))).toBe(join(root, 'repo', wrapper));
    const bare = makeTree({ 'repo/module/pom.xml': '', [wrapper]: '' });
    expect(findMavenWrapper(join(bare, 'repo', 'module'), join(bare, 'repo'))).toBeUndefined();
  });
});
