/**
 * Elevate — Gradle registry adapter for ad-hoc version queries
 * (`elevate versions`, MCP `elevate_get_versions`, the version picker).
 *
 * Like the scanner it asks Gradle instead of a fixed repository URL: a lookup
 * run of the build in the repository root lists the versions through the
 * repositories, mirrors and credentials of that build, so any Nexus or
 * Artifactory works without Elevate-specific configuration (specs/24,
 * "Single lookups use the same machinery").
 */

import { resolve } from 'node:path';
import type { RegistryEndpoint, RegistryPort } from '../../domain/ports.js';
import type { DependencyCoordinate, ReleaseChannel } from '../../domain/models.js';
import { isPreReleaseVersion } from '../../domain/versions.js';
import { findGradleBuildDirs } from './gradle-discovery.js';
import { runDescribe, runLookup } from './gradle-probe.js';
import type { GradleBuildDocument, GradleProjectDocument, GradleRepositoryDocument } from './gradle-probe.js';
import {
  buildLookupPlan,
  effectiveRepositories,
  isPublicRepositoryUrl,
  lookupFailureDetail,
  stripCredentials,
} from './gradle-repositories.js';
import { sortGradleVersions } from './gradle-versions.js';

/** A plugin id has no colon: `elevate versions org.example.plugin`. */
function isPluginId(coordinate: DependencyCoordinate): boolean {
  return !coordinate.identifier.includes(':');
}

interface RootBuild {
  /** The directory Gradle runs in. */
  dir: string;
  build: GradleBuildDocument['build'];
  /** The root project of the build, whose repositories decide. */
  project: GradleProjectDocument;
}

/**
 * The build that answers a single lookup: the one in the repository root, or
 * the first Gradle build of the repository when the root has none.
 */
async function describeRootBuild(rootDir: string): Promise<RootBuild> {
  const root = resolve(rootDir);
  const dirs = findGradleBuildDirs(root);
  const dir = dirs.includes(root) ? root : dirs[0];
  if (!dir) throw new Error(`No Gradle build found in ${root}.`);
  const documents = await runDescribe(dir, root);
  const document = documents.find((doc) => resolve(doc.build.dir) === resolve(dir)) ?? documents[0]!;
  return { dir, build: document.build, project: document.projects[0]! };
}

/** The internal scopes of the repository, read when a lookup needs them (the config module imports the adapters). */
async function internalScopesOf(rootDir: string): Promise<readonly string[]> {
  const { loadConfig } = await import('../../config.js');
  return loadConfig(rootDir).internalScopes;
}

function describeRepository(repository: GradleRepositoryDocument): string {
  return stripCredentials(repository.url ?? repository.name);
}

export class GradleRegistryAdapter implements RegistryPort {
  /**
   * Where a lookup would go: the first repository of the build that is not a
   * well-known public one, otherwise the first public one. An internal package
   * is refused when only public repositories would be asked.
   */
  async resolveEndpoint(coordinate: DependencyCoordinate, cwd: string): Promise<RegistryEndpoint> {
    const { build, project } = await describeRootBuild(cwd);
    const repositories = effectiveRepositories(build, project, isPluginId(coordinate) ? 'plugin' : 'module');
    const privateRepository = repositories.find((r) => !isPublicRepositoryUrl(r.url));
    if (privateRepository) return { url: describeRepository(privateRepository), isPublic: false };
    const first = repositories[0];
    return first
      ? { url: describeRepository(first), isPublic: true }
      : { url: `no repository declared for ${project.path}`, isPublic: false };
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
   * All versions available in the repositories of the build, newest first.
   * Throws when Gradle fails or a repository could not be read, so an error is
   * never mistaken for "no versions".
   */
  async getAllVersions(coordinate: DependencyCoordinate, cwd = process.cwd()): Promise<string[]> {
    if (!coordinate.group || !coordinate.artifact) return [];
    const plugin = isPluginId(coordinate);

    const { dir, build, project } = await describeRootBuild(cwd);
    const kind = plugin ? 'plugin' : 'module';
    const repositories = effectiveRepositories(build, project, kind);
    if (repositories.length === 0) throw new Error(`the build declares no repository for ${project.path}`);

    const { plan } = buildLookupPlan(
      [
        {
          buildRoot: build.dir,
          project: project.path,
          kind,
          group: coordinate.group,
          name: plugin ? `${coordinate.group}.gradle.plugin` : coordinate.artifact,
          repositories,
        },
      ],
      await internalScopesOf(cwd),
    );
    const [answer] = await runLookup(dir, resolve(cwd), plan);
    if (!answer) throw new Error('Gradle gave no answer for this lookup.');
    if (answer.error !== null) throw new Error(lookupFailureDetail(answer.error, undefined).text);
    return sortGradleVersions(answer.versions);
  }
}
