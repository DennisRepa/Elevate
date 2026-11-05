/**
 * GRDUPD-38 to GRDUPD-42: an update through the real command line and the real
 * MCP server, judged by a real Gradle on the fixture `gradle-multi-project`
 * (local file repository with real jars, no network).
 *
 *   npm run test:integration
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { elevate, jsonOf, withMcp } from '../elevate-process.js';
import { cleanupTemp, copyFixture, writeJarRepository } from '../helpers.js';

afterAll(cleanupTemp);

const ready = ['gradle', 'javac'].every((tool) => spawnSync(tool, ['--version'], { encoding: 'utf8' }).status === 0 || spawnSync(tool, ['-version'], { encoding: 'utf8' }).status === 0);

const lib = (versions: Record<string, string>) => ({
  group: 'com.acme',
  name: 'lib',
  versions: Object.fromEntries(Object.entries(versions).map(([v, body]) => [v, { 'com/acme/Lib.java': `package com.acme; public class Lib { ${body} }` }])),
});
const GREET = 'public static String greet() { return "hi"; }';
const HELLO = 'public static String hello() { return "hi"; }';

/** A copy of the fixture whose repository holds the given versions of `com.acme:lib`. */
function project(versions: Record<string, string>): string {
  const root = copyFixture('gradle-multi-project');
  writeJarRepository(join(root, 'repo'), [lib(versions)]);
  return root;
}

const script = (root: string) => readFileSync(join(root, 'app/build.gradle'), 'utf8');
const UPDATE = ['update', '--ecosystem=gradle', '--module=:app', '--packages=com.acme:lib'];

describe.skipIf(!ready)('an update through the command line and the MCP server', () => {
  it('GRDUPD-38 A dry run lists the planned changes and the files they would touch', () => {
    const root = project({ '1.0': GREET, '1.1': GREET });
    const original = script(root);
    const result = elevate(root, ...UPDATE, '--dry-run', '--json');
    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json).toMatchObject({ dryRun: true, ecosystem: 'gradle', targetModule: 'app' });
    expect(json.updates).toEqual([
      { identifier: 'com.acme:lib', action: 'update', currentRange: '1.0', newRange: '1.1', diff: 'minor', declaredIn: 'app/build.gradle' },
    ]);
    expect(script(root)).toBe(original);
  }, 300_000);

  it('GRDUPD-39 A finished update reports the files that changed', () => {
    const root = project({ '1.0': GREET, '1.1': GREET });
    const result = elevate(root, ...UPDATE, '--json');
    expect(result.status, result.stderr).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json).toMatchObject({ success: true, updatedCount: 1, rolledBack: false, changedFiles: ['app/build.gradle'] });
    expect(json.verification).toMatchObject({ status: 'clean', label: 'Gradle build (:app:testClasses)' });
    expect(script(root)).toContain("'com.acme:lib:1.1'");
  }, 300_000);

  it('GRDUPD-40 A rolled back update exits with 2 and says why', () => {
    const root = project({ '1.0': GREET, '2.0': HELLO });
    const original = script(root);
    const result = elevate(root, ...UPDATE, '--allow-major');
    expect(result.status).toBe(2);
    expect(`${result.stdout}${result.stderr}`).toContain('❌ Update failed and was rolled back.');
    expect(script(root)).toBe(original);
  }, 300_000);

  it('GRDUPD-41 The MCP tool elevate_apply_updates reports the same summary', async () => {
    const root = project({ '1.0': GREET, '1.1': GREET });
    await withMcp(root, async (client) => {
      const result = jsonOf(
        await client.callTool({
          name: 'elevate_apply_updates',
          arguments: { ecosystem: 'gradle', moduleId: ':app', updates: [{ identifier: 'com.acme:lib' }] },
        }),
      );
      expect(result).toMatchObject({ success: true, targetModule: 'app', ecosystem: 'gradle', updatedCount: 1 });
    });
    expect(script(root)).toContain("'com.acme:lib:1.1'");
  }, 300_000);

  it('GRDUPD-42 The MCP tool elevate_verify checks the module and its dependents', async () => {
    const root = project({ '1.0': GREET, '1.1': GREET });
    await withMcp(root, async (client) => {
      const result = jsonOf(await client.callTool({ name: 'elevate_verify', arguments: { ecosystem: 'gradle', moduleId: ':core' } }));
      expect(JSON.stringify(result)).toContain('Gradle build (:app:testClasses :core:testClasses)');
      expect(JSON.stringify(result)).toContain('clean');
    });
  }, 300_000);
});
