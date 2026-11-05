/**
 * GRD-05, GRD-49, GRD-50 and GRD-51: the Gradle ecosystem through the real
 * command line and the real MCP server, with a real Gradle on the fixture
 * `gradle-composite` (core plugins only, no network).
 *
 *   npm run test:integration
 */

import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { elevate, jsonOf as textOf, withMcp } from '../elevate-process.js';
import { join } from 'node:path';
import { cleanupTemp, copyFixture, makeTree, writeVersionRepository } from '../helpers.js';

afterAll(cleanupTemp);

const gradleInstalled = spawnSync('gradle', ['--version'], { encoding: 'utf8' }).status === 0;
describe.skipIf(!gradleInstalled)('the Gradle ecosystem on the command line and in the MCP server', () => {
  it('GRD-49 The module listing names the ecosystem', () => {
    const root = copyFixture('gradle-composite');
    const result = elevate(root, 'modules', '--ecosystem=gradle');
    expect(result.status).toBe(0);
    const lines = result.stdout.split('\n');
    expect(lines.find((l) => l.includes('Discovered'))).toMatch(/^🪶 Discovered 🐘 Java \/ Gradle Modules \(\d+\):$/);
    expect(lines.some((l) => /• mono\s+\(Root\) \[ROOT\]/.test(l))).toBe(true);
    expect(lines.some((l) => /• app\s+\(app\)$/.test(l))).toBe(true);
  }, 180_000);

  it('GRD-50 The JSON listing carries the build of every module', () => {
    const root = copyFixture('gradle-composite');
    const result = elevate(root, 'modules', '--ecosystem=gradle', '--json');
    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.ecosystem).toBe('gradle');
    expect(json.count).toBe(json.modules.length);
    const logic = json.modules.find((m: { id: string }) => m.id === ':build-logic');
    expect(logic).toMatchObject({ buildKind: 'included', coordinates: 'com.acme.logic:build-logic' });
    expect(logic.buildDir).toBeTruthy();
    expect(logic.buildRoot).toBeTruthy();
  }, 180_000);

  it('GRD-05 and GRD-51 The MCP tools offer gradle, and the modules report the kind of their build', async () => {
    const root = copyFixture('gradle-composite');
    await withMcp(root, async (client) => {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(5);
      for (const tool of tools) {
        const property = (tool.inputSchema.properties as Record<string, { enum: string[]; description: string }>).ecosystem!;
        expect(property.enum).toEqual(['npm', 'maven', 'cargo', 'gradle']);
        expect(property.description).toBe('Target ecosystem (default: npm)');
      }

      const gradle = textOf(await client.callTool({ name: 'elevate_discover_modules', arguments: { ecosystem: 'gradle' } })) as {
        modules: Record<string, unknown>[];
      };
      expect(gradle.modules.length).toBeGreaterThan(0);
      for (const module of gradle.modules) {
        for (const key of ['id', 'name', 'relPath', 'isRoot', 'buildKind']) expect(module).toHaveProperty(key);
      }
      expect(gradle.modules.find((m) => m.id === ':build-logic')).toMatchObject({ buildKind: 'included' });

      const npm = textOf(await client.callTool({ name: 'elevate_discover_modules', arguments: { ecosystem: 'npm' } })) as {
        modules: Record<string, unknown>[];
      };
      for (const module of npm.modules) expect(module).not.toHaveProperty('buildKind');
    });
  }, 240_000);

  it('GRDDEC-39 The scan output names the file when it is not the build script of the module', () => {
    const root = makeTree({
      'settings.gradle': "include 'app'",
      'gradle.properties': 'jacksonVersion=1.0',
      'gradle/libs.versions.toml': '[versions]\nguava = "1.0"\n\n[libraries]\nclib = { module = "org.example:c", version.ref = "guava" }\n',
      'app/build.gradle':
        "plugins { id 'java' }\nrepositories { maven { url = uri(\"${rootDir}/repo\") } }\n" +
        'dependencies {\n    implementation \'org.example:a:1.0\'\n    implementation "org.example:b:$jacksonVersion"\n    implementation libs.clib\n}\n',
    });
    writeVersionRepository(join(root, 'repo'), { 'org.example:a': ['1.0', '1.1'], 'org.example:b': ['1.0', '1.1'], 'org.example:c': ['1.0', '1.1'] });
    const result = elevate(root, 'scan', '--ecosystem=gradle', '--module=app');
    expect(result.status, result.stderr).toBe(1);
    const lines = result.stdout.split('\n').filter((l) => l.includes('•'));
    expect(lines).toEqual([
      '   • [MINOR]   org.example:a                        1.0          ➔ 1.1',
      '   • [MINOR]   org.example:b                        1.0          ➔ 1.1  (in gradle.properties ${jacksonVersion})',
      '   • [MINOR]   org.example:c                        1.0          ➔ 1.1  (in gradle/libs.versions.toml versions.guava)',
    ]);
  }, 240_000);

  it('GRDVER-45 and GRDVER-49 The versions of a library, newest first, on the command line and in the MCP server', async () => {
    const root = makeTree({
      'settings.gradle': "rootProject.name = 'mono'",
      'build.gradle': 'repositories { maven { url = uri("${rootDir}/repo") } }\n',
    });
    writeVersionRepository(join(root, 'repo'), { 'org.example:lib': ['1.0', '1.2-rc1', '1.2', '1.1'] });

    const result = elevate(root, 'versions', 'org.example:lib', '--ecosystem=gradle', '--json');
    expect(result.status, result.stderr).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json).toMatchObject({ latest: '1.2', totalCount: 4 });
    expect(json.versions.map((v: { version: string }) => v.version)).toEqual(['1.2', '1.2-rc1', '1.1', '1.0']);
    expect(json.versions.find((v: { version: string }) => v.version === '1.2-rc1')).toMatchObject({ isPreRelease: true, tag: 'RC' });

    await withMcp(root, async (client) => {
      const viaMcp = textOf(await client.callTool({ name: 'elevate_get_versions', arguments: { ecosystem: 'gradle', identifier: 'org.example:lib' } }));
      expect(viaMcp).toMatchObject({ latest: '1.2', totalCount: 4 });
    });
  }, 240_000);
  it('A build that Gradle cannot configure is reported with Gradle\'s words, not a stack trace', () => {
    const root = makeTree({
      'settings.gradle': "rootProject.name = 'broken'",
      'build.gradle': 'this is not valid groovy {{{\n',
    });
    const result = elevate(root, 'scan', '--ecosystem=gradle');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('❌ Elevate fatal error: GradleCommandError: Gradle could not describe the build:');
    expect(result.stderr).toContain('What went wrong');
    expect(result.stderr).not.toMatch(/\n\s+at /);
  }, 240_000);
});
