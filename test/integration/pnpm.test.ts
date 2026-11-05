/**
 * End-to-end checks with a real pnpm (9 to 12) and a real registry.
 *
 *   npm run test:integration
 */

import { afterAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EcosystemFactory } from '../../src/domain/ecosystem-factory.js';
import { createScanContext } from '../../src/application/scan.js';
import { runUpdateWorkflow } from '../../src/application/update-workflow.js';
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

const sh = (cwd: string, command: string, env: NodeJS.ProcessEnv = {}) =>
  execSync(command, { cwd, stdio: 'pipe', env: { ...process.env, ...env } });
const edit = (file: string, change: (json: any) => void) => {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  change(json);
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
};

describe.skipIf(!available('pnpm --version'))('pnpm', () => {
  const npm = EcosystemFactory.getStrategy('npm');

  /** A copy of the fixture in which `@acme/app` depends on left-pad through the given range. */
  function fixture(leftPad?: string) {
    const root = copyFixture('pnpm-workspaces');
    if (leftPad) edit(join(root, 'packages/app/package.json'), (j) => (j.dependencies['left-pad'] = leftPad));
    sh(root, 'pnpm install');
    return root;
  }

  async function scanApp(root: string) {
    const modules = await npm.discovery.discover(root);
    const app = modules.find((m) => m.id === '@acme/app')!;
    const context = createScanContext(modules, { rootDir: root, internalScopes: [] }, 'stable');
    return { app, scan: await npm.reader.scan(app, context) };
  }

  it('PINST-08 With CI set, a real pnpm updates the lockfile instead of failing', async () => {
    const root = fixture('^1.1.0');
    const { app, scan } = await scanApp(root);
    const candidate = scan.candidates.find((c) => c.coordinate.identifier === 'left-pad')!;
    const previous = process.env.CI;
    process.env.CI = 'true';
    try {
      const summary = await runUpdateWorkflow(npm, app, root, [candidate]);
      expect(summary.rolledBack).toBeFalsy();
      // The real `pnpm audit --json` output is understood (not "unavailable").
      expect(summary.auditMessage).not.toMatch(/^Vulnerability check unavailable/);
    } finally {
      if (previous === undefined) delete process.env.CI;
      else process.env.CI = previous;
    }
    expect(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')).toMatch(new RegExp(`left-pad@${candidate.latest.replace(/\./g, '\\.')}`));
  });

  it('PINST-21 A real pnpm tells a consistent lockfile from a stale one', async () => {
    const root = fixture();
    const modules = await npm.discovery.discover(root);
    const rootModule = modules.find((m) => m.isRoot)!;
    expect((await npm.verifier.verify(rootModule, root)).status).toBe('clean');
    edit(join(root, 'packages/lib/package.json'), (j) => (j.dependencies = { 'left-pad': '^1.1.0' }));
    const stale = await npm.verifier.verify(rootModule, root);
    expect(stale.status).toBe('warn');
    expect(stale.details).toContain('ERR_PNPM_OUTDATED_LOCKFILE');
  });

  it('PINST-31 An aligned workspace dependency is linked, verified and kept', async () => {
    const root = fixture();
    edit(join(root, 'packages/lib/package.json'), (j) => (j.version = '2.0.0'));
    const { app, scan } = await scanApp(root);
    const candidate = scan.candidates.find((c) => c.coordinate.identifier === '@acme/lib')!;
    const summary = await runUpdateWorkflow(npm, app, root, [candidate]);
    expect(JSON.parse(readFileSync(join(root, 'packages/app/package.json'), 'utf8')).dependencies['@acme/lib']).toBe(
      'workspace:^2.0.0',
    );
    expect(summary.rolledBack).toBeFalsy();
    expect(summary.verificationStatus).toBe('clean');
    expect(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')).toMatch(/packages\/app:[\s\S]*?version: link:/);
  });

  it('CAT-15 A real pnpm accepts the new catalog range', async () => {
    const root = fixture('catalog:');
    const { app, scan } = await scanApp(root);
    const candidate = scan.candidates.find((c) => c.coordinate.identifier === 'left-pad')!;
    const summary = await runUpdateWorkflow(npm, app, root, [candidate]);
    expect(summary.rolledBack).toBeFalsy();
    expect(summary.verificationStatus).toBe('clean');
    expect(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')).toContain(`left-pad: ${candidate.newRange}`);
    expect(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')).toMatch(
      new RegExp(`catalogs:[\\s\\S]*?left-pad:\\s*specifier: \\${candidate.newRange}`),
    );
  });
});
