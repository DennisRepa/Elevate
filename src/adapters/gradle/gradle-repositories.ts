/**
 * Elevate — the repositories Gradle would use, and the lookup plan.
 *
 * Elevate never contacts a repository itself: it tells Gradle what to look up
 * (`LookupPlan`) and Gradle asks the repositories of the build with its own
 * mirrors, credentials and proxies. What Elevate decides is which repositories
 * apply to a project (`effectiveRepositories`), which of them are public
 * (`isPublicRepositoryUrl`) and which groups are internal, so that the init
 * script can keep them away from the public ones (specs/24, GRDVER-14 to 24).
 */

import type {
  GradleBuildDocument,
  GradleProjectDocument,
  GradleRepositoryDocument,
  LookupPlan,
  LookupPlanEntry,
} from './gradle-probe.js';

const PLUGIN_REPOSITORY_PREFIX = '__plugin_repository__';

/** The repository Gradle uses for plugins when the build declares none. */
export const PLUGIN_PORTAL: GradleRepositoryDocument = {
  name: 'Gradle Central Plugin Repository',
  kind: 'maven',
  url: 'https://plugins.gradle.org/m2',
};

/** Hosts that serve everybody: a company's Artifactory or Nexus is private even when it mirrors Maven Central. */
const PUBLIC_HOSTS = new Set([
  'repo.maven.apache.org',
  'repo1.maven.org',
  'central.sonatype.com',
  'plugins.gradle.org',
  'dl.google.com',
  'maven.google.com',
  'jcenter.bintray.com',
  'jitpack.io',
  'oss.sonatype.org',
  's01.oss.sonatype.org',
  'repo.spring.io',
]);

/** Strips `user:password@` and trailing slashes: credentials never leave the scan. */
export function normalizeRepositoryUrl(url: string): string {
  return stripCredentials(url).replace(/\/+$/, '');
}

/** Removes `user:password@` from a URL, or from every URL in a text. */
export function stripCredentials(text: string): string {
  return text.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/@\s'"]*@/g, '$1');
}

/** Whether the repository is a well-known public one. No URL, `file:` and any other host are private. */
export function isPublicRepositoryUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    return PUBLIC_HOSTS.has(new URL(stripCredentials(url)).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * The repositories that decide a lookup for `project`.
 *
 * Modules follow the `repositoriesMode` of the settings (fact 23). Plugins
 * follow the project's `buildscript`: the wrappers Gradle reports for the
 * plugin management are mapped to the repositories of the settings; without
 * any repository the Gradle Plugin Portal applies.
 */
export function effectiveRepositories(
  build: GradleBuildDocument['build'],
  project: GradleProjectDocument,
  kind: 'module' | 'plugin',
): GradleRepositoryDocument[] {
  if (kind === 'module') {
    const mode = build.repositoriesMode ?? 'PREFER_PROJECT';
    if (mode === 'PREFER_PROJECT') {
      return project.repositories.length > 0 ? project.repositories : build.settingsRepositories;
    }
    return build.settingsRepositories;
  }

  const mapped: GradleRepositoryDocument[] = [];
  for (const repository of project.buildscriptRepositories) {
    if (repository.name.startsWith(PLUGIN_REPOSITORY_PREFIX)) {
      const name = repository.name.slice(PLUGIN_REPOSITORY_PREFIX.length);
      const declared = build.pluginRepositories.find((candidate) => candidate.name === name);
      if (declared) mapped.push(declared);
    } else {
      mapped.push(repository);
    }
  }
  return mapped.length > 0 ? mapped : [PLUGIN_PORTAL];
}

/**
 * One regular expression per internal scope: the escaped scope followed by
 * `(\..*)?`. A scope is cleaned like `matchesInternalScope` does it: a leading
 * `@` and trailing `.`, `:` and `/` go; what is left empty gives no pattern.
 */
export function internalGroupPatterns(internalScopes: readonly string[]): string[] {
  const patterns = new Set<string>();
  for (const scope of internalScopes) {
    const prefix = scope.replace(/^@/, '').replace(/[.:/]+$/, '');
    if (prefix.length === 0) continue;
    patterns.add(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\..*)?`);
  }
  return [...patterns];
}

const EARLIER_ERROR = /^Repository .* is disabled due to earlier error below:?$|^Skipped due to earlier error$/;

/**
 * The detail Elevate shows for a failed lookup: the last message of Gradle's
 * chain (`Could not resolve … > … > Could not GET '…'. Received status code
 * 401`), without credentials. Once a repository has failed Gradle disables it,
 * and the lookups that follow fail with a note about the earlier error; their
 * detail is the one of the first failed lookup of the run, so the user sees the
 * cause and not the note.
 *
 * `isCause` is false for such a note.
 */
export function lookupFailureDetail(
  error: string,
  firstFailure: string | undefined,
): { text: string; isCause: boolean } {
  const parts = stripCredentials(error).split(' > ');
  const last = parts[parts.length - 1] ?? error;
  if (EARLIER_ERROR.test(last)) return { text: firstFailure ?? last, isCause: false };
  return { text: last, isCause: true };
}

/** One coordinate a project wants to look up, with the repositories that decide it. */
export interface LookupRequest {
  /** `build.dir` of the build the project belongs to. */
  buildRoot: string;
  /** Gradle path of the project. */
  project: string;
  kind: 'module' | 'plugin';
  group: string;
  name: string;
  /** The effective repositories of the project for this kind of lookup. */
  repositories: readonly GradleRepositoryDocument[];
}

export interface BuiltPlan {
  plan: LookupPlan;
  /** The id of the plan entry that answers a request (several requests can share one). */
  idOf(request: LookupRequest): string;
}

/** Requests of projects with the same repositories ask the same question. */
function lookupKey(request: LookupRequest): string {
  const repositories = request.repositories.map((r) => `${r.name}=${r.url === null ? '' : normalizeRepositoryUrl(r.url)}`);
  return JSON.stringify([request.buildRoot, request.kind, request.group, request.name, repositories]);
}

/**
 * Builds the plan of a lookup run. A coordinate that several projects ask with
 * the same repositories is written once, under the first project (GRDVER-35);
 * projects with different repositories look it up separately (GRDVER-36).
 */
export function buildLookupPlan(requests: readonly LookupRequest[], internalScopes: readonly string[]): BuiltPlan {
  const lookups: LookupPlanEntry[] = [];
  const idByKey = new Map<string, string>();
  const publicUrls = new Set<string>();

  for (const request of requests) {
    for (const repository of request.repositories) {
      if (repository.url !== null && isPublicRepositoryUrl(repository.url)) {
        publicUrls.add(normalizeRepositoryUrl(repository.url));
      }
    }
    const key = lookupKey(request);
    if (idByKey.has(key)) continue;
    const id = `L${lookups.length + 1}`;
    idByKey.set(key, id);
    lookups.push({
      id,
      buildRoot: request.buildRoot,
      project: request.project,
      kind: request.kind,
      group: request.group,
      name: request.name,
    });
  }

  return {
    plan: {
      protocol: 1,
      publicRepositoryUrls: [...publicUrls],
      internalGroupPatterns: internalGroupPatterns(internalScopes),
      lookups,
    },
    idOf: (request) => idByKey.get(lookupKey(request)) ?? '',
  };
}
