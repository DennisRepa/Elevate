import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { isPublicNpmRegistry, parseNpmConfig, NpmConfigReader } from '../../src/adapters/npm/npm-config.js';
import type { NpmRegistryConfig } from '../../src/adapters/npm/npm-config.js';
import { findUnlinkedWorkspaceDependencies } from '../../src/adapters/npm/npm-lockfile.js';
import { NpmModuleDiscoveryAdapter } from '../../src/adapters/npm/npm-discovery.js';
import { NpmDependencyAdapter, alignmentCandidate } from '../../src/adapters/npm/npm-scanner.js';
import { NpmRegistryAdapter, isValidPackageName } from '../../src/adapters/npm/npm-registry.js';
import type { RegistryPort } from '../../src/domain/ports.js';
import type { DependencyCoordinate, ProjectModule } from '../../src/domain/models.js';
import { createScanContext } from '../../src/application/scan.js';
import { FIXTURES, cleanupTemp, makeTree } from '../helpers.js';

afterEach(cleanupTemp);

describe('npm configuration', () => {
  it('extracts default and scoped registries', () => {
    const config = parseNpmConfig({
      registry: 'https://nexus.corp/npm-all/',
      '@acme:registry': 'https://nexus.corp/npm-internal/',
      json: true,
    });
    expect(config.registry).toBe('https://nexus.corp/npm-all/');
    expect(config.scopedRegistries.get('@acme')).toBe('https://nexus.corp/npm-internal/');
  });

  it('falls back to the public registry', () => {
    expect(parseNpmConfig({}).registry).toBe('https://registry.npmjs.org/');
  });

  it('recognises public registries by host', () => {
    expect(isPublicNpmRegistry('https://registry.npmjs.org/')).toBe(true);
    expect(isPublicNpmRegistry('https://registry.yarnpkg.com')).toBe(true);
    expect(isPublicNpmRegistry('http://nexus.corp:8081/repository/npm-all/')).toBe(false);
    expect(isPublicNpmRegistry('not a url')).toBe(false);
  });
});

describe('NpmRegistryAdapter on the stable channel', () => {
  class StubbedRegistry extends NpmRegistryAdapter {
    constructor(private readonly fields: Record<string, unknown>) {
      super();
    }
    protected override async view(_name: string, field: string): Promise<unknown> {
      return this.fields[field] ?? null;
    }
  }
  const coordinate = { identifier: 'pkg', artifact: 'pkg', ecosystem: 'npm' as const };

  it('never falls back to the pre-release the latest tag points to', async () => {
    const registry = new StubbedRegistry({
      'dist-tags.latest': '2.0.0-rc.1',
      version: '2.0.0-rc.1',
      versions: ['1.0.0', '1.9.0', '2.0.0-rc.1'],
    });
    expect(await registry.getLatestVersion(coordinate, 'stable')).toBe('1.9.0');
    expect(await registry.getLatestVersion(coordinate, 'all')).toBe('2.0.0-rc.1');
  });
});

describe('isValidPackageName', () => {
  it('accepts npm names and rejects shell metacharacters', () => {
    expect(isValidPackageName('@acme/core')).toBe(true);
    expect(isValidPackageName('lodash.merge')).toBe(true);
    expect(isValidPackageName('x & calc')).toBe(false);
    expect(isValidPackageName('a"b')).toBe(false);
  });
});

describe('findUnlinkedWorkspaceDependencies', () => {
  const lockfile = {
    packages: {
      'node_modules/@acme/core': { resolved: 'packages/core', link: true },
      'apps/web/node_modules/@acme/core': { version: '1.0.0', resolved: 'https://registry.npmjs.org/@acme/core/-/core-1.0.0.tgz' },
      'node_modules/@acme/utils': { resolved: 'packages/utils', link: true },
    },
  };

  it('uses the nearest lockfile entry, as npm resolves it', () => {
    expect(findUnlinkedWorkspaceDependencies(lockfile, 'apps/web', ['@acme/core'])).toEqual([
      '@acme/core: installed from https://registry.npmjs.org/@acme/core/-/core-1.0.0.tgz instead of linking the workspace package',
    ]);
    expect(findUnlinkedWorkspaceDependencies(lockfile, 'apps/other', ['@acme/core'])).toEqual([]);
  });

  it('reports missing entries', () => {
    expect(findUnlinkedWorkspaceDependencies(lockfile, '', ['@acme/missing'])).toHaveLength(1);
  });
});

describe('NpmModuleDiscoveryAdapter', () => {
  it('resolves glob workspace patterns like npm, including nested folders', async () => {
    const modules = await new NpmModuleDiscoveryAdapter().discover(join(FIXTURES, 'npm-workspaces'));
    expect(modules.map((m) => [m.id, m.relPath, m.version])).toEqual([
      ['acme-monorepo', 'Root', undefined],
      ['web', 'apps/web', '0.1.0'],
      ['@acme/core', 'packages/core', '2.0.0'],
      ['@acme/utils', 'packages/nested/utils', '1.4.0'],
    ]);
  });
});

/** Registry fake that records every package it was asked about. */
class FakeRegistry implements RegistryPort {
  readonly asked: string[] = [];
  constructor(
    private readonly latest: Record<string, string | null>,
    private readonly config: NpmRegistryConfig,
  ) {}
  async resolveEndpoint(coordinate: DependencyCoordinate) {
    const scope = coordinate.identifier.startsWith('@') ? coordinate.identifier.split('/')[0]! : '';
    const url = this.config.scopedRegistries.get(scope) ?? this.config.registry;
    return { url, isPublic: isPublicNpmRegistry(url) };
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
  constructor(private readonly fixed: NpmRegistryConfig) {
    super();
  }
  override async read() {
    return this.fixed;
  }
}

describe('NpmDependencyAdapter', () => {
  const root = join(FIXTURES, 'npm-workspaces');

  async function scanWeb(config: NpmRegistryConfig) {
    const modules = await new NpmModuleDiscoveryAdapter().discover(root);
    const registry = new FakeRegistry({ semver: '7.8.0', '@acme/secret-sdk': '9.9.9' }, config);
    const scanner = new NpmDependencyAdapter(registry, new FixedConfigReader(config));
    const web = modules.find((m) => m.id === 'web')!;
    const result = await scanner.scan(web, createScanContext(modules, { rootDir: root, internalScopes: ['@acme'] }, 'stable'));
    return { result, registry };
  }

  it('offers alignment for a workspace dependency npm would not link', async () => {
    const { result } = await scanWeb({ registry: 'https://registry.npmjs.org/', scopedRegistries: new Map() });
    const core = result.candidates.find((c) => c.coordinate.identifier === '@acme/core');
    expect(core).toMatchObject({ action: 'align', newRange: '^2.0.0', diff: 'major', selected: false });
    expect(core?.origin.kind).toBe('workspace');
  });

  it('never looks up workspace modules or internal packages on a public registry', async () => {
    const { result, registry } = await scanWeb({ registry: 'https://registry.npmjs.org/', scopedRegistries: new Map() });
    expect(registry.asked).toEqual(['semver']);
    expect(result.skipped).toEqual([
      {
        identifier: '@acme/secret-sdk',
        origin: 'private',
        reason: 'private-on-public-registry',
        detail: 'https://registry.npmjs.org/',
      },
    ]);
  });

  it('looks up internal packages when their registry is private', async () => {
    const { result, registry } = await scanWeb({
      registry: 'https://registry.npmjs.org/',
      scopedRegistries: new Map([['@acme', 'https://nexus.corp/npm/']]),
    });
    expect(registry.asked).toContain('@acme/secret-sdk');
    const sdk = result.candidates.find((c) => c.coordinate.identifier === '@acme/secret-sdk');
    expect(sdk?.origin).toEqual({ kind: 'private', matchedBy: 'internal-scope', registry: 'https://nexus.corp/npm/' });
  });

  it('treats a scope mapped to a public registry as public', async () => {
    const modules = await new NpmModuleDiscoveryAdapter().discover(root);
    const config = {
      registry: 'https://nexus.corp/npm/',
      scopedRegistries: new Map([['@angular', 'https://registry.npmjs.org/']]),
    };
    const registry = new FakeRegistry({}, config);
    const scanner = new NpmDependencyAdapter(registry, new FixedConfigReader(config));
    const web = modules.find((m) => m.id === 'web')!;
    const pkg = { ...web, path: makeTree({ 'package.json': '{"dependencies":{"@angular/core":"^17.0.0"}}' }) };
    const result = await scanner.scan(pkg, createScanContext(modules, { rootDir: root, internalScopes: [] }, 'stable'));
    expect(registry.asked).toEqual(['@angular/core']);
    expect(result.skipped).toEqual([{ identifier: '@angular/core', origin: 'public', reason: 'lookup-failed' }]);
  });

  it('does not touch wildcard workspace ranges', async () => {
    const { result } = await scanWeb({ registry: 'https://registry.npmjs.org/', scopedRegistries: new Map() });
    expect(result.candidates.find((c) => c.coordinate.identifier === '@acme/utils')).toBeUndefined();
  });
});

describe('alignmentCandidate', () => {
  const target: ProjectModule = {
    id: '@acme/core',
    name: '@acme/core',
    path: '/repo/packages/core',
    relPath: 'packages/core',
    ecosystem: 'npm',
    isRoot: false,
    version: '2.1.0',
  };
  const origin = { kind: 'workspace', moduleId: '@acme/core', moduleRelPath: 'packages/core' } as const;

  it('returns null when the range already includes the local version', () => {
    expect(alignmentCandidate({ name: '@acme/core', range: '^2.0.0', scope: 'prod' }, target, origin)).toBeNull();
  });

  it('keeps the range operator', () => {
    const candidate = alignmentCandidate({ name: '@acme/core', range: '~2.0.0', scope: 'dev' }, target, origin);
    expect(candidate).toMatchObject({ newRange: '~2.1.0', diff: 'minor', selected: true, scope: 'dev' });
  });

  it('ignores protocols npm links regardless of version', () => {
    for (const range of ['*', 'file:../core', 'workspace:*']) {
      expect(alignmentCandidate({ name: '@acme/core', range, scope: 'prod' }, target, origin)).toBeNull();
    }
  });
});
