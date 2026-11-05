/**
 * Elevate — Cargo registry adapter for ad-hoc version queries
 * (`elevate versions`, MCP `elevate_get_versions`, the version picker).
 */

import semver from 'semver';
import type { RegistryEndpoint, RegistryPort } from '../../domain/ports.js';
import type { DependencyCoordinate, ReleaseChannel } from '../../domain/models.js';
import type { IndexVersion } from './cargo-index.js';
import { selectVersion } from './cargo-versions.js';

export interface CargoRegistryDeps {
  index: { versions(index: string, crate: string): Promise<IndexVersion[]> };
  endpoint(registry: string | undefined, cwd: string): Promise<{ index: string; isPublic: boolean }>;
}

export class CargoRegistryAdapter implements RegistryPort {
  constructor(private readonly deps: CargoRegistryDeps) {}

  async resolveEndpoint(coordinate: DependencyCoordinate, cwd: string): Promise<RegistryEndpoint> {
    const { index, isPublic } = await this.deps.endpoint(coordinate.registry, cwd);
    return { url: index, isPublic };
  }

  async getLatestVersion(
    coordinate: DependencyCoordinate,
    channel: ReleaseChannel = 'stable',
    cwd = process.cwd(),
  ): Promise<string | null> {
    return selectVersion(await this.load(coordinate, cwd), { channel }).version ?? null;
  }

  /** Published, not yanked, newest first. Lookup errors propagate so they are not mistaken for "no versions". */
  async getAllVersions(coordinate: DependencyCoordinate, cwd = process.cwd()): Promise<string[]> {
    return (await this.load(coordinate, cwd))
      .filter((v) => !v.yanked && semver.valid(v.version))
      .map((v) => v.version)
      .sort(semver.rcompare);
  }

  private async load(coordinate: DependencyCoordinate, cwd: string): Promise<IndexVersion[]> {
    const { index } = await this.deps.endpoint(coordinate.registry, cwd);
    return this.deps.index.versions(index, coordinate.artifact);
  }
}
