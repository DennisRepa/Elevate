/**
 * Real Maven below a directory whose name cmd.exe would interpret.
 *
 *   npm run test:integration
 */

import { afterAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { EcosystemFactory } from '../../src/domain/ecosystem-factory.js';
import { createScanContext } from '../../src/application/scan.js';
import { FIXTURES, cleanupTemp, makeTree } from '../helpers.js';

afterAll(cleanupTemp);

function available(command: string): boolean {
  try {
    execSync(command, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(process.platform !== 'win32' || !available('mvn -v'))('Maven below a directory named R&D', () => {
  it('WIN-03 A Maven project below a directory named R&D can be scanned', async () => {
    const top = makeTree({ 'R&D/.keep': '' });
    const root = join(top, 'R&D');
    cpSync(join(FIXTURES, 'maven-reactor'), root, { recursive: true });

    const maven = EcosystemFactory.getStrategy('maven');
    const modules = await maven.discovery.discover(root);
    const app = modules.find((m) => m.relPath === 'app')!;
    const context = createScanContext(modules, { rootDir: root, internalScopes: ['com.acme'] }, 'stable');

    const scan = await maven.reader.scan(app, context);
    expect(scan.candidates.map((c) => c.coordinate.identifier)).toContain('com.google.guava:guava');
    expect(existsSync(join(root, 'app', 'target'))).toBe(false);
  });
});
