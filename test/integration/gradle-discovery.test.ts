import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { GradleModuleDiscoveryAdapter } from '../../src/adapters/gradle/gradle-discovery.js';
import { runDescribe } from '../../src/adapters/gradle/gradle-probe.js';
import { cleanupTemp, copyFixture } from '../helpers.js';

afterEach(cleanupTemp);

const gradleInstalled = spawnSync('gradle', ['--version'], { encoding: 'utf8' }).status === 0;

describe.skipIf(!gradleInstalled)('Gradle discovery with a real Gradle', () => {
  it('GRD-48 A real Gradle describes the fixture', async () => {
    const root = copyFixture('gradle-composite');
    const modules = await new GradleModuleDiscoveryAdapter().discover(root);
    const ids = modules.map((m) => m.id);

    expect(ids[0]).toBe(':');
    // buildSrc is described by Gradle 8 and later only (fact 32).
    const expected = [':', ':app', ':libs:core', ':build-logic'];
    expect([...ids].sort()).toEqual(
      (ids.includes(':buildSrc') ? [...expected, ':buildSrc'] : expected).sort(),
    );

    // One run describes the root build, the included build and buildSrc (fact 32: buildSrc from Gradle 8 on).
    const documents = await runDescribe(root, root);
    const kinds = Object.fromEntries(documents.map((d) => [d.build.name, d.build.kind]));
    expect(kinds).toMatchObject({ mono: 'root', 'build-logic': 'included' });
    if (documents[0]!.gradleVersion.startsWith('7.')) expect(kinds).not.toHaveProperty('buildSrc');
    else expect(kinds).toMatchObject({ buildSrc: 'buildSrc' });
    const modulesByKind = Object.fromEntries(modules.map((m) => [m.id, m.buildKind]));
    expect(modulesByKind).toMatchObject({ ':': 'root', ':app': 'root', ':libs:core': 'root', ':build-logic': 'included' });

    const build = documents.find((d) => d.build.kind === 'root')!;
    const app = build.projects.find((p) => p.path === ':app')!;
    expect(
      app.dependencies.map((d) => `${d.configuration}:${d.group}:${d.name}:${d.version}`).sort(),
    ).toEqual(['implementation:org.example:lib:1.0', 'testImplementation:org.example:test-lib:2.1']);
    expect(app.projectDependencies).toEqual([{ configuration: 'implementation', path: ':libs:core' }]);

    // The discovery leaves nothing of Elevate behind, in no build of the composite.
    const leftovers = readdirSync(root, { recursive: true }).filter((entry) => String(entry).includes('elevate-'));
    expect(leftovers).toEqual([]);
  }, 300_000);
});
