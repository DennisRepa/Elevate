/**
 * End-to-end checks with the real package managers. They need Maven (or a
 * wrapper), npm and network access to the configured repositories.
 *
 *   npm run test:integration
 */

import { afterAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EcosystemFactory } from '../../src/domain/ecosystem-factory.js';
import { createScanContext } from '../../src/application/scan.js';
import { runUpdateWorkflow } from '../../src/application/update-workflow.js';
import { lookupVersions } from '../../src/application/version-lookup.js';
import { cleanupTemp, copyFixture } from '../helpers.js';

afterAll(cleanupTemp);

function available(command: string): boolean {
  try {
    execSync(command, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!available('mvn -v'))('Maven', () => {
  const maven = EcosystemFactory.getStrategy('maven');

  it('aligns an internal module and updates a parent-managed version, then verifies the reactor', async () => {
    const root = copyFixture('maven-reactor');
    const modules = await maven.discovery.discover(root);
    const app = modules.find((m) => m.relPath === 'app')!;
    const context = createScanContext(modules, { rootDir: root, internalScopes: ['com.acme'] }, 'stable');

    const scan = await maven.reader.scan(app, context);
    const core = scan.candidates.find((c) => c.coordinate.identifier === 'com.acme:acme-core');
    const guava = scan.candidates.find((c) => c.coordinate.identifier === 'com.google.guava:guava');

    expect(core).toMatchObject({ action: 'align', latest: '1.1.0-SNAPSHOT', declaration: { displayPath: 'app/pom.xml' } });
    expect(guava).toMatchObject({ action: 'update', declaration: { kind: 'dependency-management', displayPath: 'pom.xml' } });
    expect(guava!.latest).toMatch(/-jre$/);
    // The scan leaves no trace in the project.
    expect(existsSync(join(root, 'app', 'target'))).toBe(false);

    const summary = await runUpdateWorkflow(maven, app, root, [core!, guava!]);
    expect(summary).toMatchObject({ verificationStatus: 'clean', changedFiles: ['app/pom.xml', 'pom.xml'] });
    expect(readFileSync(join(root, 'app', 'pom.xml'), 'utf8')).toContain('<version>1.1.0-SNAPSHOT</version>');
  });

  it('lists versions through the repositories Maven is configured with', async () => {
    const root = copyFixture('maven-reactor');
    const coordinate = { identifier: 'com.google.guava:guava', group: 'com.google.guava', artifact: 'guava', ecosystem: 'maven' as const };
    // An internal groupId does not block the lookup: it goes where the build goes.
    const versions = await lookupVersions(maven, coordinate, { rootDir: root, internalScopes: ['com.google'] });
    expect(versions).toContain('32.0.0-jre');
    expect(versions.indexOf('33.0.0-jre')).toBeLessThan(versions.indexOf('32.0.0-jre'));
    expect(existsSync(join(root, 'target'))).toBe(false);
  });

  it('rolls back every POM when verification fails', async () => {
    const root = copyFixture('maven-reactor');
    const before = readFileSync(join(root, 'app', 'pom.xml'), 'utf8');
    const modules = await maven.discovery.discover(root);
    const app = modules.find((m) => m.relPath === 'app')!;
    const scan = await maven.reader.scan(app, createScanContext(modules, { rootDir: root, internalScopes: [] }, 'stable'));
    const core = scan.candidates.find((c) => c.coordinate.identifier === 'com.acme:acme-core')!;

    // Passes on the current state, fails once the alignment is written, so the
    // failure is attributed to the update.
    const failsAfterUpdate = `node -e "process.exit(require('fs').readFileSync('pom.xml','utf8').includes('<version>1.0.0</version>')?0:1)"`;
    const summary = await runUpdateWorkflow(maven, app, root, [core], { postUpdateScript: failsAfterUpdate });
    expect(summary.rolledBack).toBe(true);
    expect(readFileSync(join(root, 'app', 'pom.xml'), 'utf8')).toBe(before);
  });
});

describe.skipIf(!available('npm -v'))('npm', () => {
  const npm = EcosystemFactory.getStrategy('npm');

  it('aligns a workspace dependency so npm links it instead of installing from a registry', async () => {
    const root = copyFixture('npm-workspaces');
    const webManifest = join(root, 'apps', 'web', 'package.json');
    const web = JSON.parse(readFileSync(webManifest, 'utf8'));
    delete web.dependencies['@acme/secret-sdk'];
    writeFileSync(webManifest, JSON.stringify(web, null, 2) + '\n');

    const modules = await npm.discovery.discover(root);
    const app = modules.find((m) => m.relPath === 'apps/web')!;
    const scan = await npm.reader.scan(app, createScanContext(modules, { rootDir: root, internalScopes: ['@acme'] }, 'stable'));
    const core = scan.candidates.find((c) => c.coordinate.identifier === '@acme/core')!;

    const summary = await runUpdateWorkflow(npm, app, root, [core]);
    expect(summary.rolledBack).toBeUndefined();
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    expect(lock.packages['node_modules/@acme/core']).toMatchObject({ link: true });
  });

  it('rolls back package.json when npm install fails', async () => {
    const root = copyFixture('npm-workspaces');
    const before = readFileSync(join(root, 'apps', 'web', 'package.json'), 'utf8');
    const modules = await npm.discovery.discover(root);
    const app = modules.find((m) => m.relPath === 'apps/web')!;
    const scan = await npm.reader.scan(app, createScanContext(modules, { rootDir: root, internalScopes: ['@acme'] }, 'stable'));
    const core = scan.candidates.find((c) => c.coordinate.identifier === '@acme/core')!;

    // @acme/secret-sdk does not exist on the registry the fixture's .npmrc points to.
    const summary = await runUpdateWorkflow(npm, app, root, [core]);
    expect(summary.rolledBack).toBe(true);
    expect(readFileSync(join(root, 'apps', 'web', 'package.json'), 'utf8')).toBe(before);
    expect(existsSync(join(root, 'package-lock.json'))).toBe(false);
  });
});
