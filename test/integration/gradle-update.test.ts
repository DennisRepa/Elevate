/**
 * GRDUPD-14 and GRDUPD-45 to GRDUPD-48 (and GRDCAT-18): a real Gradle judges the
 * update. The repositories are local file repositories with real jars compiled
 * by the JDK, so no network is needed.
 *
 *   npm run test:integration
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GradleModuleDiscoveryAdapter } from '../../src/adapters/gradle/gradle-discovery.js';
import { GradleDependencyAdapter } from '../../src/adapters/gradle/gradle-scanner.js';
import { GradleEcosystemStrategy } from '../../src/adapters/gradle/gradle-strategy.js';
import { runUpdateWorkflow } from '../../src/application/update-workflow.js';
import type { UpdateSummary } from '../../src/domain/models.js';
import { cleanupTemp, copyFixture, runGradleIn, writeJarRepository } from '../helpers.js';

afterEach(cleanupTemp);

const available = (tool: string) => spawnSync(tool, ['--version'], { encoding: 'utf8' }).status === 0 || spawnSync(tool, ['-version'], { encoding: 'utf8' }).status === 0;
const ready = available('gradle') && available('javac');

const lib = (group: string, versions: Record<string, string>) => ({
  group,
  name: 'lib',
  versions: Object.fromEntries(
    Object.entries(versions).map(([version, body]) => [version, { [`${group.replaceAll('.', '/')}/Lib.java`]: `package ${group}; public class Lib { ${body} }` }]),
  ),
});
const GREET = 'public static String greet() { return "hi"; }';
const HELLO = 'public static String hello() { return "hi"; }';

/** Scans `:app` and updates the library to what the repositories offer, with the update workflow. */
async function update(root: string, identifier: string): Promise<UpdateSummary> {
  const modules = await new GradleModuleDiscoveryAdapter().discover(root);
  const module = modules.find((m) => m.id === ':app')!;
  const scanned = await new GradleDependencyAdapter().scan(module, { rootDir: root, workspace: new Map(), internalScopes: [], channel: 'stable' });
  const candidate = scanned.candidates.find((c) => c.coordinate.identifier === identifier);
  expect(candidate, JSON.stringify(scanned.skipped)).toBeDefined();
  return runUpdateWorkflow(new GradleEcosystemStrategy(), module, root, [candidate!], {});
}

const read = (root: string, file: string) => readFileSync(join(root, file), 'utf8');

describe.skipIf(!ready)('a real Gradle judges the update', () => {
  it('GRDUPD-45 A compatible update passes the verification', async () => {
    const root = copyFixture('gradle-multi-project');
    writeJarRepository(join(root, 'repo'), [lib('com.acme', { '1.0': GREET, '1.1': GREET })]);
    const summary = await update(root, 'com.acme:lib');
    expect(summary.rolledBack).toBeUndefined();
    expect(summary).toMatchObject({ verificationStatus: 'clean', verificationLabel: 'Gradle build (:app:testClasses)' });
    expect(read(root, 'app/build.gradle')).toContain("'com.acme:lib:1.1'");
  }, 600_000);

  it('GRDUPD-46 An update that breaks the compile is rolled back', async () => {
    const root = copyFixture('gradle-multi-project');
    writeJarRepository(join(root, 'repo'), [lib('com.acme', { '1.0': GREET, '2.0': HELLO })]);
    const original = read(root, 'app/build.gradle');
    const summary = await update(root, 'com.acme:lib');
    expect(summary.rolledBack).toBe(true);
    expect(summary.verificationDetails).toContain('cannot find symbol');
    expect(read(root, 'app/build.gradle')).toBe(original);
    expect(read(root, 'app/build.gradle')).toContain("'com.acme:lib:1.0'");
  }, 600_000);

  it('GRDUPD-47 A build with dependency verification refuses the new artifacts and is rolled back', async () => {
    const root = copyFixture('gradle-multi-project');
    writeJarRepository(join(root, 'repo'), [lib('com.acme', { '1.0': GREET, '1.1': GREET })]);
    const generated = runGradleIn(root, '--write-verification-metadata', 'sha256', ':app:compileJava');
    expect(generated.status, generated.output).toBe(0);
    const metadata = read(root, 'gradle/verification-metadata.xml');
    expect(metadata).toContain('lib');

    const summary = await update(root, 'com.acme:lib');
    expect(summary.rolledBack).toBe(true);
    expect(summary.verificationDetails).toContain("Dependency verification failed for configuration ':app:compileClasspath'");
    expect(read(root, 'gradle/verification-metadata.xml')).toBe(metadata);
    expect(read(root, 'app/build.gradle')).toContain("'com.acme:lib:1.0'");
  }, 600_000);

  it('GRDUPD-14 A real Gradle accepts the refreshed locks', async () => {
    const root = copyFixture('gradle-locking');
    writeJarRepository(join(root, 'repo'), [lib('com.acme', { '1.0': GREET, '1.1': GREET })]);
    const locked = runGradleIn(root, ':app:dependencies', ':core:dependencies', '--write-locks');
    expect(locked.status, locked.output).toBe(0);
    expect(read(root, 'app/gradle.lockfile')).toContain('com.acme:lib:1.0');
    expect(read(root, 'core/gradle.lockfile')).toContain('com.acme:lib:1.0');

    const summary = await update(root, 'com.acme:lib');
    expect(summary.rolledBack).toBeUndefined();
    expect(summary.verificationStatus).toBe('clean');
    expect(summary.auditMessage).toMatch(/Refreshed 2 dependency lock file\(s\)\.$/);
    expect(read(root, 'app/gradle.lockfile')).toContain('com.acme:lib:1.1');
    expect(read(root, 'core/gradle.lockfile')).not.toContain('com.acme:lib:1.0');
    expect(summary.changedFiles).toEqual(expect.arrayContaining(['app/build.gradle', 'app/gradle.lockfile', 'core/gradle.lockfile']));
  }, 600_000);

  it('GRDUPD-48 and GRDCAT-18 A build in the Kotlin DSL with a version catalog is updated and verified', async () => {
    const root = copyFixture('gradle-catalog');
    writeJarRepository(join(root, 'repo'), [lib('org.example', { '1.0': GREET, '1.1': GREET })]);
    const original = read(root, 'gradle/libs.versions.toml');
    const script = read(root, 'app/build.gradle.kts');

    const summary = await update(root, 'org.example:lib');
    expect(summary.rolledBack).toBeUndefined();
    expect(summary.verificationStatus).toBe('clean');
    // Only the version of the catalog changes.
    expect(read(root, 'gradle/libs.versions.toml')).toBe(original.replace('"1.0"', '"1.1"'));
    expect(read(root, 'app/build.gradle.kts')).toBe(script);
    expect(summary.changedFiles).toEqual(['gradle/libs.versions.toml']);
  }, 600_000);
});
