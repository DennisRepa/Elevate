import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { resolveConfig } from '../../src/config.js';
import {
  DEFAULT_MAVEN_PLUGINS,
  MavenPluginUnavailableError,
  ScratchDirectory,
  queryNewerVersions,
  readEffectivePoms,
} from '../../src/adapters/maven/maven-resolution.js';
import { MavenCommandError } from '../../src/adapters/maven/maven-command.js';
import { EcosystemFactory } from '../../src/domain/ecosystem-factory.js';
import { createScanContext } from '../../src/application/scan.js';
import { FakeMaven, effectivePom } from '../maven-fake.js';
import { cleanupTemp, makeTree, pom } from '../helpers.js';

// Maven itself is replaced by a test double that records its arguments.
const mocks = vi.hoisted(() => ({ runMaven: vi.fn() }));
vi.mock('../../src/adapters/maven/maven-command.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/adapters/maven/maven-command.js')>()),
  runMaven: mocks.runMaven,
}));

const HELP_GOAL = (version: string) => `org.apache.maven.plugins:maven-help-plugin:${version}:effective-pom`;
const VERSIONS_GOAL = (version: string) => `org.codehaus.mojo:versions-maven-plugin:${version}:dependency-updates-report`;

let maven: FakeMaven;
beforeEach(() => {
  maven = new FakeMaven();
  mocks.runMaven.mockImplementation(maven.run);
});
afterEach(() => {
  EcosystemFactory.configure({});
  cleanupTemp();
});

const PROJECT = pom('<groupId>g</groupId><artifactId>app</artifactId><version>1</version>');

describe('the versions can be set per repository in elevate.config.json', () => {
  it('PLUG-01 Without the setting the defaults apply', () => {
    const config = resolveConfig('/repo', JSON.parse('{}'));
    expect(config.mavenPlugins.help).toBe('3.5.2');
    expect(config.mavenPlugins.versions).toBe('2.22.0');
    expect(config.warnings).toEqual([]);
  });

  it('PLUG-03 One key can be set on its own', () => {
    const config = resolveConfig('/repo', JSON.parse('{"mavenPlugins": {"versions": "2.16.2"}}'));
    expect(config.mavenPlugins.help).toBe('3.5.2');
    expect(config.mavenPlugins.versions).toBe('2.16.2');
    expect(config.warnings).toEqual([]);
  });

  // The value column is JSON text, as in the feature file.
  it.each(['""', '"latest"', '"RELEASE"', '"3.4.0 & calc"', '"3.4.0\\"; rm -rf"', '3', 'null', '["3.4.0"]'])(
    'PLUG-04 An invalid version is replaced by the default with a warning: %s',
    (value) => {
      const config = resolveConfig('/repo', JSON.parse(`{"mavenPlugins": {"help": ${value}}}`));
      expect(config.mavenPlugins.help).toBe('3.5.2');
      expect(config.warnings).toEqual([`\`mavenPlugins.help\` is not a valid version (${value}); using the default 3.5.2.`]);
    },
  );

  it('PLUG-09 A mavenPlugins value that is not an object is ignored', () => {
    const config = resolveConfig('/repo', JSON.parse('{"mavenPlugins": "2.16.2"}'));
    expect(config.mavenPlugins.help).toBe('3.5.2');
    expect(config.mavenPlugins.versions).toBe('2.22.0');
    expect(config.warnings).toEqual([]);
  });
});

describe('the configured versions are the ones Maven is asked to run', () => {
  /** Scans a Maven project with one dependency through the factory's Maven strategy. */
  async function scanProject() {
    const root = makeTree({ 'pom.xml': PROJECT });
    maven.answers = { effectivePom: effectivePom([{ groupId: 'com.google.guava', artifactId: 'guava', version: '1' }]) };
    const strategy = EcosystemFactory.getStrategy('maven');
    const modules = await strategy.discovery.discover(root);
    await strategy.reader.scan(modules[0]!, createScanContext(modules, { rootDir: root, internalScopes: [] }, 'stable'));
  }

  const goalsAsked = () => maven.runs.flatMap((run) => run.args);

  it('PLUG-02 A scan uses the configured versions', async () => {
    EcosystemFactory.configure({ mavenPlugins: { help: '3.4.0', versions: '2.16.2' } });
    await scanProject();
    expect(goalsAsked()).toContain(HELP_GOAL('3.4.0'));
    expect(goalsAsked()).toContain(VERSIONS_GOAL('2.16.2'));
  });

  it('PLUG-08 A version query uses the configured versions', async () => {
    EcosystemFactory.configure({ mavenPlugins: { help: '3.4.0', versions: '2.16.2' } });
    const dir = makeTree({ 'pom.xml': PROJECT });
    const coordinate = { identifier: 'com.google.guava:guava', group: 'com.google.guava', artifact: 'guava', ecosystem: 'maven' as const };
    await EcosystemFactory.getStrategy('maven').registry.getAllVersions(coordinate, dir);
    expect(goalsAsked()).toContain(HELP_GOAL('3.4.0'));
    expect(goalsAsked()).toContain(VERSIONS_GOAL('2.16.2'));
  });

  it('PLUG-10 An unconfigured factory uses the defaults', async () => {
    EcosystemFactory.configure({});
    await scanProject();
    expect(goalsAsked()).toContain(HELP_GOAL('3.5.2'));
    expect(goalsAsked()).toContain(VERSIONS_GOAL('2.22.0'));
  });
});

describe('a plugin that cannot be downloaded is reported as such', () => {
  const noDependencies = { dependencies: [], managedDependencies: [] };

  /** Reads the effective POM of a project while Maven fails with the given output. */
  async function readEffectivePomFailing(output: string) {
    const dir = makeTree({ 'pom.xml': PROJECT });
    maven.answers = { failure: output };
    const scratch = new ScratchDirectory(dir);
    try {
      return await readEffectivePoms(join(dir, 'pom.xml'), dir, dir, scratch, DEFAULT_MAVEN_PLUGINS).catch((err: unknown) => err);
    } finally {
      scratch.dispose();
    }
  }

  it('PLUG-05 The help plugin is missing from the mirror', async () => {
    const failure = await readEffectivePomFailing(
      [
        '[ERROR] Plugin org.apache.maven.plugins:maven-help-plugin:3.5.2 or one of its dependencies could not be resolved:',
        '[ERROR] \tThe following artifacts could not be resolved: org.apache.maven.plugins:maven-help-plugin:pom:3.5.2 (absent): Could not find artifact org.apache.maven.plugins:maven-help-plugin:pom:3.5.2 in corp-mirror (https://nexus.corp.example/repository/maven-public/)',
        '[ERROR] -> [Help 1]',
      ].join('\n'),
    );
    expect(failure).toBeInstanceOf(MavenPluginUnavailableError);
    const message = (failure as Error).message;
    expect(
      message.startsWith(
        'Maven could not download org.apache.maven.plugins:maven-help-plugin:3.5.2, which Elevate uses to read the effective POM. Make this plugin available in the repository or mirror your Maven is configured with, or choose a version that is available there with "mavenPlugins": { "help": "<version>" } in elevate.config.json.',
      ),
    ).toBe(true);
    expect(message).toContain('corp-mirror');
  });

  it('PLUG-06 The versions plugin is missing from the mirror', async () => {
    const dir = makeTree({ 'pom.xml': PROJECT });
    maven.answers = {
      failure:
        '[ERROR] Failed to read artifact descriptor for org.codehaus.mojo:versions-maven-plugin:jar:2.16.2: Could not transfer artifact org.codehaus.mojo:versions-maven-plugin:pom:2.16.2 from/to corp-mirror (https://nexus.corp.example/repository/maven-public/): status code: 403',
    };
    const scratch = new ScratchDirectory(dir);
    let failure: unknown;
    try {
      failure = await queryNewerVersions(
        [{ groupId: 'g', artifactId: 'a', version: '1' }],
        noDependencies,
        dir,
        dir,
        scratch,
        { ...DEFAULT_MAVEN_PLUGINS, versions: '2.16.2' },
      ).catch((err: unknown) => err);
    } finally {
      scratch.dispose();
    }
    expect(failure).toBeInstanceOf(MavenPluginUnavailableError);
    expect(
      (failure as Error).message.startsWith(
        'Maven could not download org.codehaus.mojo:versions-maven-plugin:2.16.2, which Elevate uses to look up newer versions. Make this plugin available in the repository or mirror your Maven is configured with, or choose a version that is available there with "mavenPlugins": { "versions": "<version>" } in elevate.config.json.',
      ),
    ).toBe(true);
  });

  it('PLUG-07 Any other Maven failure keeps its own message', async () => {
    const failure = await readEffectivePomFailing(
      '[ERROR] Non-resolvable parent POM for com.acme:app:1.0.0: Could not find artifact com.acme:parent:pom:9.9.9 in central (https://repo.maven.apache.org/maven2)',
    );
    expect(failure).toBeInstanceOf(MavenCommandError);
    expect(failure).not.toBeInstanceOf(MavenPluginUnavailableError);
    expect((failure as Error).message.startsWith('Maven could not build the effective POM:')).toBe(true);
    expect((failure as Error).message).toContain('Non-resolvable parent POM');
  });
});
