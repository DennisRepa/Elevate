/**
 * Elevate — npm dependency scanner.
 *
 * Classifies every dependency of a module by origin and consults the matching
 * version source:
 *
 * - workspace: the local version of the sibling module. A dependency whose
 *   range does not include that version is not linked by npm but installed
 *   from a registry, so it is offered for alignment.
 * - private: the registry configured for the package; never a public one.
 * - public: the configured registry via `npm view` (`pnpm view` in a pnpm repository).
 *
 * In a pnpm repository `workspace:` ranges are aligned, a plain range on a
 * module is listed as not linked, and `catalog:` ranges are resolved through
 * pnpm-workspace.yaml.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import semver from 'semver';
import type { DependencyReaderPort, RegistryPort, ScanContext } from '../../domain/ports.js';
import type {
  DependencyCoordinate,
  VersionDeclaration,
  DependencyOrigin,
  ProjectModule,
  ScanResult,
  SkippedDependency,
  UpdateCandidate,
} from '../../domain/models.js';
import { classifyOrigin } from '../../domain/origin.js';
import { diffVersions, extractPreReleaseTag, rangePrefix } from '../../domain/versions.js';
import { mapPooled } from '../shared/pool.js';
import { isPublicNpmRegistry } from './npm-config.js';
import type { NpmConfigReader } from './npm-config.js';
import { prepareSupportedPackageManager } from './npm-package-manager.js';
import { splitRangeProtocol } from './npm-protocols.js';
import { readPnpmWorkspace } from './pnpm-workspace.js';
import type { PnpmWorkspace } from './pnpm-workspace.js';
import { isValidPackageName } from './npm-registry.js';

const CONCURRENCY = 6;
const DIFF_ORDER: Record<string, number> = { major: 0, minor: 1, patch: 2 };

interface DeclaredDependency {
  name: string;
  range: string;
  scope: 'prod' | 'dev';
}

type Outcome = { candidate: UpdateCandidate } | { skipped: SkippedDependency } | null;

export class NpmDependencyAdapter implements DependencyReaderPort {
  constructor(
    private readonly registry: RegistryPort,
    private readonly config: NpmConfigReader,
  ) {}

  async scan(module: ProjectModule, context: ScanContext): Promise<ScanResult> {
    const manager = await prepareSupportedPackageManager(context.rootDir);
    const pnpm = manager === 'pnpm';

    let pkg: any;
    try {
      pkg = JSON.parse(readFileSync(join(module.path, 'package.json'), 'utf8'));
    } catch {
      return { candidates: [], skipped: [] };
    }

    const npmConfig = await this.config.read(context.rootDir);
    const originContext = {
      workspace: context.workspace,
      internalScopes: context.internalScopes,
      // A scope mapped to a public registry is not internal; only private
      // mappings mark their scope as private.
      scopedRegistries: new Map(
        [...npmConfig.scopedRegistries].filter(([, url]) => !isPublicNpmRegistry(url)),
      ),
    };

    const workspaceFile = pnpm ? readPnpmWorkspace(context.rootDir) : undefined;

    const outcomes = await mapPooled(declaredDependencies(pkg), CONCURRENCY, async (dep): Promise<Outcome> => {
      const origin = classifyOrigin(dep.name, 'npm', originContext);
      if (origin.kind === 'workspace') {
        const target = context.workspace.get(dep.name);
        if (pnpm && isUpgradableRange(dep.range) && splitRangeProtocol(dep.range).protocol === undefined) {
          // pnpm resolves a plain range from the registry, never from the workspace.
          return { skipped: { identifier: dep.name, origin: 'workspace', reason: 'not-linked', detail: dep.range } };
        }
        const candidate = target ? alignmentCandidate(dep, target, origin, pnpm) : null;
        return candidate ? { candidate } : null;
      }
      if (pnpm && splitRangeProtocol(dep.range).protocol === 'catalog') {
        return this.catalogOutcome(dep, origin, context, module.path, workspaceFile);
      }
      return this.registryOutcome(dep, origin, context);
    });

    const candidates: UpdateCandidate[] = [];
    const skipped: SkippedDependency[] = [];
    for (const outcome of outcomes) {
      if (!outcome) continue;
      if ('candidate' in outcome) candidates.push(outcome.candidate);
      else skipped.push(outcome.skipped);
    }

    candidates.sort((a, b) => (DIFF_ORDER[a.diff] ?? 3) - (DIFF_ORDER[b.diff] ?? 3));
    return { candidates, skipped };
  }

  /** A `catalog:` dependency: the range comes from pnpm-workspace.yaml and is written back there. */
  private async catalogOutcome(
    dep: DeclaredDependency,
    origin: DependencyOrigin,
    context: ScanContext,
    modulePath: string,
    workspaceFile: PnpmWorkspace | undefined,
  ): Promise<Outcome> {
    const catalogName = splitRangeProtocol(dep.range).rest || 'default';
    const unresolved = (detail: string): Outcome => ({
      skipped: { identifier: dep.name, origin: origin.kind, reason: 'catalog-unresolved', detail },
    });
    if (!workspaceFile) return unresolved('pnpm-workspace.yaml is missing or not valid YAML');
    if (catalogName === 'default' && workspaceFile.ambiguousDefaultCatalog) {
      return unresolved("catalog 'default' is defined twice (catalog and catalogs.default)");
    }
    const catalog = workspaceFile.catalogs.get(catalogName);
    if (!catalog) return unresolved(`no catalog '${catalogName}'`);
    const range = catalog.get(dep.name);
    if (range === undefined) return unresolved(`no entry for '${dep.name}' in catalog '${catalogName}'`);

    const declaration: VersionDeclaration = {
      file: workspaceFile.file,
      kind: 'catalog',
      catalogName,
      displayPath: 'pnpm-workspace.yaml',
    };
    const sharedWith = usersOfCatalogEntry(context, modulePath, dep.name, catalogName);
    return this.registryOutcome({ ...dep, range }, origin, context, {
      declaration,
      ...(sharedWith.length > 0 ? { sharedWith } : {}),
    });
  }

  /** Looks up a private or public dependency in its registry. */
  private async registryOutcome(
    dep: DeclaredDependency,
    origin: DependencyOrigin,
    context: ScanContext,
    extra: Partial<UpdateCandidate> = {},
  ): Promise<Outcome> {
    // Git URLs, file paths, aliases and dist-tags are not registry versions.
    if (!isUpgradableRange(dep.range)) return null;

    if (!isValidPackageName(dep.name)) {
      return { skipped: { identifier: dep.name, origin: origin.kind, reason: 'invalid-name' } };
    }

    const coordinate: DependencyCoordinate = { identifier: dep.name, artifact: dep.name, ecosystem: 'npm' };

    let resolvedOrigin = origin;
    if (origin.kind === 'private') {
      // Asking a public registry about an internal name is exactly what a
      // dependency-confusion attack exploits, so the lookup is not made at all.
      const endpoint = await this.registry.resolveEndpoint(coordinate, context.rootDir);
      if (endpoint.isPublic) {
        return {
          skipped: {
            identifier: dep.name,
            origin: 'private',
            reason: 'private-on-public-registry',
            detail: endpoint.url,
          },
        };
      }
      resolvedOrigin = { ...origin, registry: endpoint.url };
    }

    const latest = await this.registry.getLatestVersion(coordinate, context.channel, context.rootDir);
    if (!latest) {
      return { skipped: { identifier: dep.name, origin: origin.kind, reason: 'lookup-failed' } };
    }

    const currentClean = semver.minVersion(dep.range)?.version;
    if (!currentClean || !semver.valid(latest) || !semver.gt(latest, currentClean)) return null;

    const tag = semver.prerelease(latest) ? extractPreReleaseTag(latest) ?? 'PRE' : undefined;
    const diff = diffVersions(currentClean, latest);
    return {
      candidate: {
        coordinate,
        currentRange: dep.range,
        currentClean,
        latest,
        newRange: `${rangePrefix(dep.range)}${latest}`,
        diff,
        scope: dep.scope,
        selected: diff !== 'major',
        origin: resolvedOrigin,
        action: 'update',
        isPreRelease: tag !== undefined,
        preReleaseTag: tag,
        ...extra,
      },
    };
  }
}

/**
 * The sections whose ranges say "this is what I install": they are scanned and
 * written. `peerDependencies`, `overrides` and `bundleDependencies` are
 * statements to others and are never offered or changed. Listed in npm's
 * increasing precedence for a name declared more than once.
 */
export const DEPENDENCY_SECTIONS = ['dependencies', 'optionalDependencies', 'devDependencies'] as const;

/**
 * Lists the dependencies of the scanned sections once per name. A name in
 * several sections takes the range of the last one in `DEPENDENCY_SECTIONS`
 * (npm installs the optional range over the regular one); a name that is also
 * a devDependency counts as dev.
 */
function declaredDependencies(pkg: any): DeclaredDependency[] {
  const deps = new Map<string, DeclaredDependency>();
  for (const section of DEPENDENCY_SECTIONS) {
    const scope = section === 'devDependencies' ? 'dev' : 'prod';
    for (const [name, range] of Object.entries(pkg[section] ?? {})) {
      if (typeof range === 'string') deps.set(name, { name, range, scope });
    }
  }
  return [...deps.values()];
}

/** Whether a range is a SemVer range pinned to something more specific than "any". */
export function isUpgradableRange(range: string): boolean {
  const trimmed = range.trim();
  if (trimmed === '' || trimmed === '*' || trimmed.toLowerCase() === 'x') return false;
  return semver.validRange(trimmed) !== null;
}

/**
 * Builds an alignment candidate when the declared range excludes the local
 * version of the workspace module, i.e. when npm would not link the module.
 * Ranges npm links regardless of the version (`*`, `file:`, `link:`,
 * `workspace:`) never need alignment.
 */
export function alignmentCandidate(
  dep: DeclaredDependency,
  target: ProjectModule,
  origin: DependencyOrigin,
  pnpm = false,
): UpdateCandidate | null {
  // Only a pnpm repository interprets `workspace:`; elsewhere it is no SemVer range and stays untouched.
  const split = pnpm ? splitRangeProtocol(dep.range) : { protocol: undefined, rest: dep.range };
  const range = split.protocol === 'workspace' ? split.rest : dep.range;
  const protocol = split.protocol === 'workspace' ? 'workspace:' : '';

  const local = target.version;
  if (!local || !semver.valid(local) || !isUpgradableRange(range)) return null;
  if (semver.satisfies(local, range, { includePrerelease: true })) return null;

  const currentClean = semver.minVersion(range)?.version ?? '0.0.0';
  const diff = diffVersions(currentClean, local);
  const tag = semver.prerelease(local) ? extractPreReleaseTag(local) ?? 'PRE' : undefined;

  return {
    coordinate: { identifier: dep.name, artifact: dep.name, ecosystem: 'npm' },
    currentRange: dep.range,
    currentClean,
    latest: local,
    newRange: `${protocol}${rangePrefix(range)}${local}`,
    diff,
    scope: dep.scope,
    selected: diff !== 'major',
    origin,
    action: 'align',
    availableVersions: [local],
    isPreRelease: tag !== undefined,
    preReleaseTag: tag,
  };
}

/** Ids of the other modules whose scanned sections refer to the same catalog entry. */
function usersOfCatalogEntry(context: ScanContext, selfPath: string, name: string, catalogName: string): string[] {
  const users: string[] = [];
  for (const module of context.workspace.values()) {
    if (module.path === selfPath) continue;
    let pkg: any;
    try {
      pkg = JSON.parse(readFileSync(join(module.path, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    const dep = declaredDependencies(pkg).find((d) => d.name === name);
    if (!dep || splitRangeProtocol(dep.range).protocol !== 'catalog') continue;
    if ((splitRangeProtocol(dep.range).rest || 'default') !== catalogName) continue;
    users.push(module.id);
  }
  return users;
}
