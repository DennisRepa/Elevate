import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// `npm install` is replaced by a test double that succeeds.
const process_ = vi.hoisted(() => ({ runCommand: vi.fn() }));
vi.mock('../../src/adapters/shared/process.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/adapters/shared/process.js')>()),
  runCommand: process_.runCommand,
}));

import { NpmConfigReader } from '../../src/adapters/npm/npm-config.js';
import type { NpmRegistryConfig } from '../../src/adapters/npm/npm-config.js';
import { NpmDependencyAdapter } from '../../src/adapters/npm/npm-scanner.js';
import { NpmUpdaterAdapter } from '../../src/adapters/npm/npm-updater.js';
import { createScanContext } from '../../src/application/scan.js';
import type { DependencyCoordinate } from '../../src/domain/models.js';
import type { RegistryPort } from '../../src/domain/ports.js';
import { cleanupTemp, makeTree, npmCandidate, npmModule } from '../helpers.js';

beforeEach(() => {
  process_.runCommand.mockReset();
  process_.runCommand.mockResolvedValue({ exitCode: 0, stdout: 'found 0 vulnerabilities', stderr: '', timedOut: false });
});
afterEach(cleanupTemp);

/** Registry double that answers from a map and records every package it was asked about. */
class FakeRegistry implements RegistryPort {
  readonly asked: string[] = [];
  constructor(private readonly latest: Record<string, string>) {}
  async resolveEndpoint() {
    return { url: 'https://registry.npmjs.org/', isPublic: true };
  }
  async getLatestVersion(coordinate: DependencyCoordinate) {
    this.asked.push(coordinate.identifier);
    return this.latest[coordinate.identifier] ?? null;
  }
  async getAllVersions() {
    return [];
  }
}

class FixedConfigReader extends NpmConfigReader {
  override async read(): Promise<NpmRegistryConfig> {
    return { registry: 'https://registry.npmjs.org/', scopedRegistries: new Map() };
  }
}

async function scan(packageJson: string, latest: Record<string, string>) {
  const root = makeTree({ 'package.json': packageJson });
  const module = npmModule(root, 'm');
  const registry = new FakeRegistry(latest);
  const result = await new NpmDependencyAdapter(registry, new FixedConfigReader()).scan(
    module,
    createScanContext([module], { rootDir: root, internalScopes: [] }, 'stable'),
  );
  return { result, registry };
}

/** Applies one candidate to a package.json and returns the file's text before and after. */
async function update(packageJson: string, name: string, from: string, to: string) {
  const root = makeTree({ 'package.json': packageJson });
  await new NpmUpdaterAdapter().applyUpdates(npmModule(root, 'm'), root, [npmCandidate(name, from, to)], () => {});
  return { before: packageJson, after: readFileSync(join(root, 'package.json'), 'utf8') };
}

describe('optional dependencies', () => {
  it('COV-01 An outdated optional dependency is offered', async () => {
    const { result } = await scan(
      '{"name": "m", "version": "1.0.0", "optionalDependencies": {"fsevents": "^2.1.0"}}',
      { fsevents: '2.3.3' },
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      coordinate: { identifier: 'fsevents' },
      currentRange: '^2.1.0',
      newRange: '^2.3.3',
      scope: 'prod',
    });
  });

  it('COV-02 The new range is written to optionalDependencies', async () => {
    const { after } = await update(
      JSON.stringify({ name: 'm', version: '1.0.0', optionalDependencies: { fsevents: '^2.1.0' } }, null, 2),
      'fsevents',
      '^2.1.0',
      '^2.3.3',
    );
    expect(JSON.parse(after).optionalDependencies).toMatchObject({ fsevents: '^2.3.3' });
  });

  it("COV-03 A name declared in several sections follows npm's precedence", async () => {
    const { result } = await scan(
      JSON.stringify({
        name: 'm',
        version: '1.0.0',
        dependencies: { a: '^1.0.0', b: '^1.0.0' },
        optionalDependencies: { a: '^1.2.0' },
        devDependencies: { b: '^1.4.0' },
      }),
      { a: '1.9.0', b: '1.9.0' },
    );
    const byName = (name: string) => result.candidates.filter((c) => c.coordinate.identifier === name);
    expect(byName('a')).toHaveLength(1);
    expect(byName('b')).toHaveLength(1);
    expect(byName('a')[0]).toMatchObject({ currentRange: '^1.2.0', scope: 'prod' });
    expect(byName('b')[0]).toMatchObject({ currentRange: '^1.4.0', scope: 'dev' });
    expect(result.candidates).toHaveLength(2);
  });

  it('COV-07 Every section that declares the name receives the new range', async () => {
    const { after } = await update(
      JSON.stringify(
        { name: 'm', version: '1.0.0', dependencies: { a: '^1.0.0' }, optionalDependencies: { a: '^1.2.0' } },
        null,
        2,
      ),
      'a',
      '^1.2.0',
      '^1.9.0',
    );
    const pkg = JSON.parse(after);
    expect(pkg.dependencies).toMatchObject({ a: '^1.9.0' });
    expect(pkg.optionalDependencies).toMatchObject({ a: '^1.9.0' });
  });
});

describe('peer dependencies, overrides and bundled dependencies', () => {
  it('COV-04 A package declared only as a peer dependency is not looked up', async () => {
    const { result, registry } = await scan(
      '{"name": "m", "version": "1.0.0", "peerDependencies": {"react": "^17.0.0"}}',
      { react: '19.0.0' },
    );
    expect(result.candidates).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(registry.asked).not.toContain('react');
  });

  it('COV-05 Updating a development dependency leaves the peer range and overrides untouched', async () => {
    const { after } = await update(
      JSON.stringify(
        {
          name: 'm',
          version: '1.0.0',
          devDependencies: { react: '^17.0.0' },
          peerDependencies: { react: '^17.0.0' },
          overrides: { react: '^17.0.0' },
          bundleDependencies: ['react'],
        },
        null,
        2,
      ),
      'react',
      '^17.0.0',
      '^19.0.0',
    );
    const pkg = JSON.parse(after);
    expect(pkg.devDependencies).toMatchObject({ react: '^19.0.0' });
    expect(pkg.peerDependencies).toMatchObject({ react: '^17.0.0' });
    expect(pkg.overrides).toMatchObject({ react: '^17.0.0' });
    expect(pkg.bundleDependencies).toEqual(['react']);
  });

  it('COV-06 The formatting of package.json is preserved', async () => {
    const original =
      JSON.stringify({ name: 'm', version: '1.0.0', optionalDependencies: { fsevents: '^2.1.0' } }, null, '\t').replace(
        /\n/g,
        '\r\n',
      ) + '\r\n';
    const { before, after } = await update(original, 'fsevents', '^2.1.0', '^2.3.3');
    expect(after).toBe(before.replace('^2.1.0', '^2.3.3'));
  });
});
