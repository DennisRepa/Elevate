/**
 * Elevate — npm registry adapter.
 *
 * Queries versions through `npm view`, so the registry, authentication and
 * proxy settings of the user's npm configuration apply automatically.
 */

import semver from 'semver';
import type { RegistryEndpoint, RegistryPort } from '../../domain/ports.js';
import type { DependencyCoordinate, ReleaseChannel } from '../../domain/models.js';
import { runCommand } from '../shared/process.js';
import { NpmConfigReader, isPublicNpmRegistry } from './npm-config.js';

const LOOKUP_TIMEOUT_MS = 15_000;

/** Valid npm package names (lower- or mixed-case legacy names included). */
const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

/** Whether a string is a syntactically valid npm package name. */
export function isValidPackageName(name: string): boolean {
  return name.length <= 214 && PACKAGE_NAME.test(name);
}

export class NpmRegistryAdapter implements RegistryPort {
  constructor(readonly config = new NpmConfigReader()) {}

  async resolveEndpoint(coordinate: DependencyCoordinate, cwd: string): Promise<RegistryEndpoint> {
    const url = await this.config.registryFor(coordinate.identifier, cwd);
    return { url, isPublic: isPublicNpmRegistry(url) };
  }

  async getLatestVersion(
    coordinate: DependencyCoordinate,
    channel: ReleaseChannel = 'stable',
    cwd = process.cwd(),
  ): Promise<string | null> {
    if (!isValidPackageName(coordinate.identifier)) return null;

    if (channel === 'stable') {
      // The `latest` dist-tag is the maintainers' designated stable release.
      const latest = await this.view(coordinate.identifier, 'dist-tags.latest', cwd);
      if (typeof latest === 'string' && semver.valid(latest) && semver.prerelease(latest) === null) {
        return latest;
      }
      // The tag points to a pre-release (or is missing): fall back to the
      // highest published release, never to the pre-release itself.
      const releases = (await this.getAllVersions(coordinate, cwd)).filter(
        (v) => semver.valid(v) && semver.prerelease(v) === null,
      );
      return releases.length > 0 ? semver.rsort(releases)[0]! : null;
    }

    // `version` is the version the `latest` tag points to.
    const version = await this.view(coordinate.identifier, 'version', cwd);
    return typeof version === 'string' && version ? version : null;
  }

  async getAllVersions(coordinate: DependencyCoordinate, cwd = process.cwd()): Promise<string[]> {
    if (!isValidPackageName(coordinate.identifier)) return [];
    const versions = await this.view(coordinate.identifier, 'versions', cwd);
    const list = Array.isArray(versions) ? versions : versions ? [versions] : [];
    return list.map(String).reverse();
  }

  /** Runs `npm view <name> <field> --json`; resolves null on any failure. */
  protected async view(name: string, field: string, cwd: string): Promise<unknown> {
    try {
      const result = await runCommand('npm', ['view', name, field, '--json'], {
        cwd,
        timeoutMs: LOOKUP_TIMEOUT_MS,
      });
      if (result.exitCode !== 0 || !result.stdout.trim()) return null;
      return JSON.parse(result.stdout);
    } catch {
      return null;
    }
  }
}
