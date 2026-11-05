/**
 * Helpers shared by the pnpm tests.
 */

import { NpmConfigReader, isPublicNpmRegistry } from '../src/adapters/npm/npm-config.js';
import type { NpmRegistryConfig } from '../src/adapters/npm/npm-config.js';
import { NpmDependencyAdapter } from '../src/adapters/npm/npm-scanner.js';
import { NpmModuleDiscoveryAdapter } from '../src/adapters/npm/npm-discovery.js';
import { join } from 'node:path';
import { npmModule } from './helpers.js';
import { createScanContext } from '../src/application/scan.js';
import type { RegistryPort } from '../src/domain/ports.js';
import type { DependencyCoordinate } from '../src/domain/models.js';

export const PUBLIC: NpmRegistryConfig = { registry: 'https://registry.npmjs.org/', scopedRegistries: new Map() };

export class FakeRegistry implements RegistryPort {
  readonly asked: string[] = [];
  constructor(
    private readonly latest: Record<string, string | null>,
    private readonly config: NpmRegistryConfig = PUBLIC,
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

/** Scans one module of a tree with a registry test double. */
export async function scanModuleOf(
  root: string,
  moduleId: string,
  latest: Record<string, string | null> = {},
  internalScopes: string[] = [],
  config: NpmRegistryConfig = PUBLIC,
) {
  const modules = await new NpmModuleDiscoveryAdapter().discover(root);
  const registry = new FakeRegistry(latest, config);
  const scanner = new NpmDependencyAdapter(registry, new FixedConfigReader(config));
  // Without a usable workspace file discovery reports the root only; the module is then taken from packages/<id>.
  const module = modules.find((m) => m.id === moduleId) ?? npmModule(join(root, 'packages', moduleId), moduleId, false);
  const result = await scanner.scan(module, createScanContext(modules, { rootDir: root, internalScopes }, 'stable'));
  return { result, registry, module, modules };
}
