/**
 * Elevate — Cargo dependency scanner.
 *
 * `cargo metadata` says which dependencies a crate has and where each comes
 * from; the Cargo.toml text says where the version is written. Both are
 * combined: a dependency becomes a candidate only when its declaration was
 * found and agrees with what Cargo resolved.
 *
 * - workspace: a path dependency on a member. Cargo refuses a `version` that
 *   excludes the member's version, so such a literal is offered for alignment.
 * - private: a crate from an alternative registry, or named by `internalScopes`.
 *   It is looked up only in its own registry, never on a public one.
 * - public: everything else, looked up in the registry Cargo would use.
 */

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import semver from 'semver';
import type { DependencyReaderPort, ScanContext } from '../../domain/ports.js';
import type {
  DependencyOrigin,
  ProjectModule,
  ScanResult,
  SkippedDependency,
  UpdateCandidate,
  VersionDeclaration,
} from '../../domain/models.js';
import { matchesInternalScope } from '../../domain/origin.js';
import { extractPreReleaseTag } from '../../domain/versions.js';
import { mapPooled } from '../shared/pool.js';
import type { IndexVersion } from './cargo-index.js';
import type { CargoMetadata, MetadataDependency, MetadataPackage } from './cargo-metadata.js';
import {
  cargoDiff,
  isUpgradableRequirement,
  requirementFloor,
  rewriteRequirement,
  satisfiesRequirement,
  toSemverRange,
} from './cargo-requirement.js';
import { parseCargoManifest } from './cargo-toml.js';
import type { DependencyDeclaration, DependencySection } from './cargo-toml.js';
import { readLockedVersions } from './cargo-lockfile.js';
import { eligibleVersions, selectVersion } from './cargo-versions.js';

const CONCURRENCY = 6;
const DIFF_ORDER: Record<string, number> = { major: 0, minor: 1, patch: 2 };

export interface CargoScannerDeps {
  loadMetadata(dir: string): Promise<CargoMetadata>;
  index: { versions(index: string, crate: string): Promise<IndexVersion[]> };
  /** The index a lookup goes to: the alternative registry's, or the one Cargo uses for crates.io. */
  endpoint(registry: string | undefined, cwd: string): Promise<{ index: string; isPublic: boolean }>;
}

type Outcome = { candidate: UpdateCandidate; note?: SkippedDependency } | { skipped: SkippedDependency } | null;

export class CargoDependencyAdapter implements DependencyReaderPort {
  constructor(private readonly deps: CargoScannerDeps) {}

  async scan(module: ProjectModule, context: ScanContext): Promise<ScanResult> {
    const metadata = await this.deps.loadMetadata(module.aggregatorDir ?? module.path);
    const pkg = metadata.packages.find((p) => samePath(join(p.manifest_path, '..'), module.path));
    if (!pkg) return { candidates: [], skipped: [] };

    const own = readDeclarations(pkg.manifest_path);
    const locks = readLockedVersions(join(metadata.workspace_root, 'Cargo.lock'));
    const rootManifest = join(metadata.workspace_root, 'Cargo.toml');
    const root = readDeclarations(rootManifest);
    const groups = groupDependencies(pkg.dependencies);

    const outcomes = await mapPooled(groups, CONCURRENCY, async (group): Promise<Outcome> => {
      const primary = group.find((d) => d.kind === null) ?? group[0]!;
      const key = primary.rename ?? primary.name;
      const decl = findDeclaration(own, key, primary);
      const located = locate(decl, root, key, context.rootDir, pkg.manifest_path, rootManifest);
      const scope = group.every((d) => d.kind === 'dev') ? 'dev' : 'prod';
      const qualifier = primary.target ?? (primary.kind === 'build' ? 'build' : undefined);
      const common = { scope, qualifier } as const;

      if (primary.source === null && primary.path) {
        // Matched by location: a path dependency elsewhere that shares a member's name is not that member.
        const target = [...context.workspace.values()].find((m) => samePath(m.path, primary.path!));
        return target ? alignment(primary, target, located, common) : null;
      }
      if (!primary.source || primary.source.startsWith('git+')) return null;
      const outcome = await this.registryOutcome(primary, located, pkg, metadata, locks, common, context);
      const other = group.find((d) => d !== primary && !sameRequirement(d.req, primary.req));
      if (outcome && 'candidate' in outcome && other) {
        // Only the declarations that match the scanned requirement are rewritten; say what is left.
        outcome.note = {
          identifier: primary.name,
          origin: outcome.candidate.origin.kind,
          reason: 'declaration-mismatch',
          detail: `${sectionOf(other)} requires ${other.req}; it is not changed`,
        };
      }
      return outcome;
    });

    const candidates: UpdateCandidate[] = [];
    const skipped: SkippedDependency[] = [];
    for (const outcome of outcomes) {
      if (!outcome) continue;
      if ('candidate' in outcome) {
        candidates.push(outcome.candidate);
        if (outcome.note) skipped.push(outcome.note);
      }
      else skipped.push(outcome.skipped);
    }
    candidates.sort((a, b) => (DIFF_ORDER[a.diff] ?? 3) - (DIFF_ORDER[b.diff] ?? 3));
    return { candidates, skipped };
  }

  private async registryOutcome(
    dep: MetadataDependency,
    located: Located | undefined,
    pkg: MetadataPackage,
    metadata: CargoMetadata,
    locks: Map<string, string[]>,
    common: { scope: 'prod' | 'dev'; qualifier: string | undefined },
    context: ScanContext,
  ): Promise<Outcome> {
    const literal = located?.version.value ?? dep.req;
    if (!isUpgradableRequirement(literal)) return null;

    if (!located || !sameRequirement(located.version.value, dep.req)) {
      return { skipped: { identifier: dep.name, origin: 'public', reason: 'declaration-mismatch', detail: `${literal} in the manifest, ${dep.req} for Cargo` } };
    }

    let origin: DependencyOrigin = { kind: 'public' };
    if (dep.registry) origin = { kind: 'private', matchedBy: 'scoped-registry', registry: dep.registry };
    else if (matchesInternalScope(dep.name, 'cargo', context.internalScopes)) origin = { kind: 'private', matchedBy: 'internal-scope' };

    const endpoint = await this.deps.endpoint(dep.registry ?? undefined, context.rootDir);
    if (origin.kind === 'private' && endpoint.isPublic) {
      // Asking a public registry about an internal name is what dependency confusion exploits.
      return { skipped: { identifier: dep.name, origin: 'private', reason: 'private-on-public-registry', detail: endpoint.index } };
    }

    let versions: IndexVersion[];
    try {
      versions = await this.deps.index.versions(endpoint.index, dep.name);
    } catch (err) {
      return { skipped: { identifier: dep.name, origin: origin.kind, reason: 'lookup-failed', detail: err instanceof Error ? err.message : String(err) } };
    }

    const chosen = selectVersion(versions, { channel: context.channel, rustVersion: pkg.rust_version ?? undefined });
    const floor = requirementFloor(literal);
    if (!chosen.version) {
      if (chosen.blockedByMsrv && floor) {
        const { version, requires } = chosen.blockedByMsrv;
        return { skipped: { identifier: dep.name, origin: origin.kind, reason: 'incompatible-rust-version', detail: ` (${version} needs Rust ${requires})` } };
      }
      return { skipped: { identifier: dep.name, origin: origin.kind, reason: 'lookup-failed', detail: 'no usable version in the registry' } };
    }

    const latest = chosen.version;
    if (!floor || !semver.gt(latest, floor)) {
      // Nothing usable is newer, but a release held back by the project's Rust version is worth a note.
      const held = chosen.blockedByMsrv;
      if (floor && held && semver.gt(held.version, floor)) {
        return { skipped: { identifier: dep.name, origin: origin.kind, reason: 'incompatible-rust-version', detail: ` (${held.version} needs Rust ${held.requires})` } };
      }
      return null;
    }
    const newRange = rewriteRequirement(literal, latest);
    // The requirement already allows the newest release: only the lock file can be behind.
    if (newRange === literal) return lockOutcome(dep, literal, origin, versions, pkg, metadata, locks, common, context);

    const tag = semver.prerelease(latest) ? (extractPreReleaseTag(latest) ?? 'PRE') : undefined;
    const diff = cargoDiff(floor, latest);
    const candidate: UpdateCandidate = {
      coordinate: { identifier: dep.name, artifact: dep.name, ecosystem: 'cargo', ...(dep.registry ? { registry: dep.registry } : {}) },
      currentRange: literal,
      currentClean: floor,
      latest,
      newRange,
      diff,
      scope: common.scope,
      selected: diff !== 'major',
      origin,
      action: 'update',
      declaration: located.declaration,
      isPreRelease: tag !== undefined,
      preReleaseTag: tag,
      ...(common.qualifier ? { qualifier: common.qualifier } : {}),
      ...(located.inherited ? { sharedWith: sharersOf(metadata, pkg, dep.rename ?? dep.name) } : {}),
    };
    return { candidate };
  }
}

/**
 * The lock file holds an older version than the requirement allows. Offered only when the
 * requirement itself needs no change, so a crate never appears twice.
 */
function lockOutcome(
  dep: MetadataDependency,
  requirement: string,
  origin: DependencyOrigin,
  versions: IndexVersion[],
  pkg: MetadataPackage,
  metadata: CargoMetadata,
  locks: Map<string, string[]>,
  common: { scope: 'prod' | 'dev'; qualifier: string | undefined },
  context: ScanContext,
): Outcome {
  const locked = (locks.get(dep.name) ?? []).filter((v) => satisfiesRequirement(requirement, v)).sort(semver.rcompare)[0];
  if (!locked) return null;

  const options = { channel: context.channel, rustVersion: pkg.rust_version ?? undefined };
  const allowed = versions.filter((v) => satisfiesRequirement(requirement, v.version));
  const newer = eligibleVersions(allowed, options).filter((v) => semver.gt(v, locked));
  const latest = newer[0];
  if (!latest) return null;

  const lockFile = join(metadata.workspace_root, 'Cargo.lock');
  return {
    candidate: {
      coordinate: { identifier: dep.name, artifact: dep.name, ecosystem: 'cargo', ...(dep.registry ? { registry: dep.registry } : {}) },
      currentRange: locked,
      currentClean: locked,
      latest,
      newRange: latest,
      diff: cargoDiff(locked, latest),
      scope: common.scope,
      // A release the requirement allows is compatible by definition, so it is safe to preselect.
      selected: true,
      origin,
      action: 'lock',
      declaration: { file: lockFile, kind: 'lockfile', displayPath: display(context.rootDir, lockFile) },
      availableVersions: newer,
      ...(common.qualifier ? { qualifier: common.qualifier } : {}),
    },
  };
}

interface Located {
  version: { value: string; start: number; end: number };
  declaration: VersionDeclaration;
  inherited: boolean;
}

function alignment(
  dep: MetadataDependency,
  target: ProjectModule,
  located: Located | undefined,
  common: { scope: 'prod' | 'dev'; qualifier: string | undefined },
): Outcome {
  const local = target.version;
  if (!located || !local || !semver.valid(local)) return null;
  const literal = located.version.value;
  if (!isUpgradableRequirement(literal) || satisfiesRequirement(literal, local)) return null;

  const floor = requirementFloor(literal) ?? '0.0.0';
  const diff = cargoDiff(floor, local);
  const tag = semver.prerelease(local) ? (extractPreReleaseTag(local) ?? 'PRE') : undefined;
  return {
    candidate: {
      coordinate: { identifier: dep.name, artifact: dep.name, ecosystem: 'cargo' },
      currentRange: literal,
      currentClean: floor,
      latest: local,
      newRange: rewriteRequirement(literal, local),
      diff,
      scope: common.scope,
      selected: diff !== 'major',
      origin: { kind: 'workspace', moduleId: target.id, moduleRelPath: target.relPath },
      action: 'align',
      declaration: located.declaration,
      availableVersions: [local],
      isPreRelease: tag !== undefined,
      preReleaseTag: tag,
      ...(common.qualifier ? { qualifier: common.qualifier } : {}),
    },
  };
}

function groupDependencies(deps: MetadataDependency[]): MetadataDependency[][] {
  const groups = new Map<string, MetadataDependency[]>();
  for (const dep of deps) {
    const id = `${dep.rename ?? dep.name}`;
    groups.set(id, [...(groups.get(id) ?? []), dep]);
  }
  return [...groups.values()];
}

function readDeclarations(manifestPath: string): DependencyDeclaration[] {
  try {
    return parseCargoManifest(readFileSync(manifestPath, 'utf8'));
  } catch {
    return [];
  }
}

const sectionOf = (dep: MetadataDependency): DependencySection =>
  dep.kind === 'dev' ? 'dev-dependencies' : dep.kind === 'build' ? 'build-dependencies' : 'dependencies';

function findDeclaration(decls: DependencyDeclaration[], key: string, dep: MetadataDependency) {
  const candidates = decls.filter((d) => !d.inWorkspace && d.key === key);
  return (
    candidates.find((d) => d.section === sectionOf(dep) && (d.target ?? null) === dep.target) ?? candidates[0]
  );
}

function locate(
  decl: DependencyDeclaration | undefined,
  root: DependencyDeclaration[],
  key: string,
  repoRoot: string,
  manifestPath: string,
  rootManifest: string,
): Located | undefined {
  if (!decl) return undefined;
  if (decl.inherited) {
    const shared = root.find((d) => d.inWorkspace && d.key === key);
    if (!shared?.version) return undefined;
    return {
      version: shared.version,
      inherited: true,
      declaration: { file: rootManifest, kind: 'dependency-management', displayPath: display(repoRoot, rootManifest) },
    };
  }
  if (!decl.version) return undefined;
  return {
    version: decl.version,
    inherited: false,
    declaration: { file: manifestPath, kind: 'dependency', displayPath: display(repoRoot, manifestPath) },
  };
}

/** Other members that inherit the same workspace dependency. */
function sharersOf(metadata: CargoMetadata, self: MetadataPackage, key: string): string[] {
  return metadata.packages
    .filter((p) => p !== self)
    .filter((p) => readDeclarations(p.manifest_path).some((d) => d.key === key && d.inherited))
    .map((p) => p.name);
}

const display = (repoRoot: string, file: string) => relative(repoRoot, file).replace(/\\/g, '/');
const samePath = (a: string, b: string) => relative(a, b) === '';

function sameRequirement(literal: string, req: string): boolean {
  const a = toSemverRange(literal);
  const b = toSemverRange(req);
  return a !== null && b !== null && semver.validRange(a) === semver.validRange(b);
}
