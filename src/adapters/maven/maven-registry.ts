/**
 * Elevate — Maven registry adapter for ad-hoc version queries
 * (`elevate versions`, MCP `elevate_get_versions`).
 *
 * Like the scanner, it asks Maven itself instead of a fixed repository URL:
 * the versions-maven-plugin lists every version newer than `0` through the
 * repositories, mirrors and credentials of the user's `settings.xml` and of the
 * repository's root POM. Any Nexus or Artifactory therefore works without
 * Elevate-specific configuration.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RegistryEndpoint, RegistryPort } from '../../domain/ports.js';
import type { DependencyCoordinate, ReleaseChannel } from '../../domain/models.js';
import { isPreReleaseVersion } from '../../domain/versions.js';
import { MavenCommandError } from './maven-command.js';
import { DEFAULT_MAVEN_PLUGINS, ScratchDirectory, queryNewerVersions, readEffectivePoms } from './maven-resolution.js';
import type { EffectiveModel, MavenPluginVersions } from './maven-resolution.js';

/** A version lower than any real one, so the report lists all versions as newer. */
const PROBE_VERSION = '0';

const NO_REPOSITORIES: EffectiveModel = { dependencies: [], managedDependencies: [] };

export class MavenRegistryAdapter implements RegistryPort {
  constructor(private readonly plugins: MavenPluginVersions = DEFAULT_MAVEN_PLUGINS) {}

  /**
   * The repositories come from Maven's own configuration, which Elevate does
   * not interpret. They are reported as non-public: the lookup goes exactly
   * where the project's build would go.
   */
  async resolveEndpoint(): Promise<RegistryEndpoint> {
    return { url: 'repositories configured for Maven (settings.xml, POM)', isPublic: false };
  }

  async getLatestVersion(
    coordinate: DependencyCoordinate,
    channel: ReleaseChannel = 'stable',
    cwd = process.cwd(),
  ): Promise<string | null> {
    const versions = await this.getAllVersions(coordinate, cwd);
    return versions.find((v) => channel === 'all' || !isPreReleaseVersion(v)) ?? null;
  }

  /**
   * All versions available in the configured repositories, newest first.
   * Throws `MavenCommandError` when Maven fails or a repository could not be
   * read, so an error is never mistaken for "no versions".
   */
  async getAllVersions(coordinate: DependencyCoordinate, cwd = process.cwd()): Promise<string[]> {
    if (!coordinate.group || !coordinate.artifact) return [];
    const key = `${coordinate.group}:${coordinate.artifact}`;

    const scratch = new ScratchDirectory(cwd);
    try {
      const repositories = await projectRepositories(cwd, scratch, this.plugins);
      const report = await queryNewerVersions(
        [{ groupId: coordinate.group, artifactId: coordinate.artifact, version: PROBE_VERSION }],
        repositories,
        cwd,
        cwd,
        scratch,
        this.plugins,
      );
      const versions = report.newerVersions.get(key) ?? [];
      if (versions.length === 0 && report.failedLookups.has(key)) {
        throw new MavenCommandError(`A Maven repository failed to deliver the versions of ${key}.`, '');
      }
      return [...versions].reverse();
    } finally {
      scratch.dispose();
    }
  }
}

/**
 * Repositories declared in the root POM (including its parents), so projects
 * that declare their repositories in the POM rather than in settings.xml are
 * covered too. Without a root POM, settings.xml alone applies.
 */
async function projectRepositories(
  cwd: string,
  scratch: ScratchDirectory,
  plugins: MavenPluginVersions,
): Promise<EffectiveModel> {
  const rootPom = join(cwd, 'pom.xml');
  if (!existsSync(rootPom)) return NO_REPOSITORIES;
  const models = await readEffectivePoms(rootPom, cwd, cwd, scratch, plugins);
  return [...models.values()][0] ?? NO_REPOSITORIES;
}
