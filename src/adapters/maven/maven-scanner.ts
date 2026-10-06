/**
 * Elevate — Maven dependency scanner.
 *
 * For each module:
 *  1. Maven builds the effective POM: the versions that actually apply.
 *  2. Each dependency is classified by origin. Modules of the same reactor are
 *     compared with their local version (alignment); all others, modules of
 *     other reactors included, are looked up with the versions-maven-plugin
 *     through the build's own repositories.
 *  3. For every offered change the declaring literal is located, so the
 *     update edits the right file — possibly a parent POM's property.
 *
 * Offered per module: its effective dependencies, the dependency management
 * entries it declares itself (including imported BOMs) and its parent when
 * that parent is not part of the repository.
 *
 * Maven runs are expensive (a JVM start each), so `scanMany` batches modules
 * of one reactor: one effective POM for the whole reactor and one version
 * report for all artifacts of all requested modules.
 */

import { join } from 'node:path';
import type { DependencyReaderPort, ScanContext } from '../../domain/ports.js';
import type {
  DependencyOrigin,
  ProjectModule,
  ReleaseChannel,
  ScanResult,
  SkippedDependency,
  UpdateCandidate,
} from '../../domain/models.js';
import { classifyOrigin } from '../../domain/origin.js';
import semver from 'semver';
import { cleanJavaVersion, diffVersions, extractPreReleaseTag, isPreReleaseVersion } from '../../domain/versions.js';
import { MavenProject } from './maven-project.js';
import { interpolate } from './maven-pom.js';
import type { PomModel } from './maven-pom.js';
import { locateDependencyVersion, locateManagedVersion, locateParentVersion } from './maven-locator.js';
import type { DeclarationLookup } from './maven-locator.js';
import { ScratchDirectory, mergeRepositories, queryNewerVersions, readEffectivePoms } from './maven-resolution.js';
import { DEFAULT_MAVEN_PLUGINS } from './maven-resolution.js';
import type { EffectiveModel, MavenPluginVersions, VersionReport } from './maven-resolution.js';

const DIFF_ORDER: Record<string, number> = { major: 0, minor: 1, patch: 2 };

/** A dependency of the module together with how its version is located. */
interface Subject {
  groupId: string;
  artifactId: string;
  version: string;
  type?: string;
  classifier?: string;
  scope: UpdateCandidate['scope'];
  locate: (effectiveVersion: string) => DeclarationLookup;
}

/** A module whose dependencies are known but not yet looked up in the repositories. */
interface ModulePlan {
  module: ProjectModule;
  effective: EffectiveModel;
  candidates: UpdateCandidate[];
  skipped: SkippedDependency[];
  lookups: { subject: Subject; origin: DependencyOrigin }[];
}

/** Modules scanned with the same Maven runs. */
interface ScanGroup {
  /** Directory Maven runs in and the scratch directory lives below. */
  dir: string;
  /** Aggregator POM resolved recursively, when the group is a reactor batch. */
  aggregatorPom?: string;
  members: { module: ProjectModule; pom: PomModel }[];
}

export class MavenDependencyAdapter implements DependencyReaderPort {
  constructor(private readonly plugins: MavenPluginVersions = DEFAULT_MAVEN_PLUGINS) {}

  async scan(module: ProjectModule, context: ScanContext): Promise<ScanResult> {
    const results = await this.scanMany([module], context);
    return results.get(module) ?? { candidates: [], skipped: [] };
  }

  async scanMany(modules: readonly ProjectModule[], context: ScanContext): Promise<Map<ProjectModule, ScanResult>> {
    const project = MavenProject.load(context.rootDir);
    const results = new Map<ProjectModule, ScanResult>();

    for (const group of groupModules(project, modules)) {
      const scratch = new ScratchDirectory(group.dir);
      try {
        for (const [module, result] of await this.scanGroup(project, group, context, scratch)) {
          results.set(module, result);
        }
      } finally {
        scratch.dispose();
      }
    }
    return results;
  }

  private async scanGroup(
    project: MavenProject,
    group: ScanGroup,
    context: ScanContext,
    scratch: ScratchDirectory,
  ): Promise<Map<ProjectModule, ScanResult>> {
    const rootDir = context.rootDir;
    const effectiveModels = group.aggregatorPom
      ? await readEffectivePoms(group.aggregatorPom, group.dir, rootDir, scratch, this.plugins, true)
      : await readEffectivePoms(group.members[0]!.pom.file, group.dir, rootDir, scratch, this.plugins);

    const plans: ModulePlan[] = [];
    for (const { module, pom } of group.members) {
      const coordinates = project.coordinatesOf(pom);
      // A module the reactor run did not cover (e.g. only listed in a profile)
      // is resolved on its own.
      const effective =
        effectiveModels.get(`${coordinates.groupId}:${coordinates.artifactId}`) ??
        (group.aggregatorPom
          ? [...(await readEffectivePoms(pom.file, module.path, rootDir, scratch, this.plugins)).values()][0]
          : [...effectiveModels.values()][0]);
      if (!effective) continue;
      plans.push(planModule(project, pom, module, effective, context));
    }

    const probe = plans.flatMap((plan) => plan.lookups.map(({ subject }) => subject));
    const report = await queryNewerVersions(
      probe,
      mergeRepositories(plans.map((plan) => plan.effective)),
      group.dir,
      rootDir,
      scratch,
      this.plugins,
    );

    return new Map(plans.map((plan) => [plan.module, finishModule(plan, report, context.channel)]));
  }
}

/**
 * Batches requested modules by reactor. A single module, or a module outside
 * any reactor, is resolved on its own (`-N`), which is cheaper than resolving
 * a whole reactor for it.
 */
function groupModules(project: MavenProject, modules: readonly ProjectModule[]): ScanGroup[] {
  const groups = new Map<string, ScanGroup>();
  const reactorSizes = new Map<string, number>();
  for (const module of modules) {
    if (module.aggregatorDir) reactorSizes.set(module.aggregatorDir, (reactorSizes.get(module.aggregatorDir) ?? 0) + 1);
  }

  for (const module of modules) {
    const pom = project.pomAt(join(module.path, 'pom.xml'));
    if (!pom) continue;
    const reactor = module.aggregatorDir;
    const batched = reactor !== undefined && (reactorSizes.get(reactor) ?? 0) > 1;
    const key = batched ? `reactor:${reactor}` : `module:${module.path}`;
    const group = groups.get(key) ?? {
      dir: batched ? reactor : module.path,
      aggregatorPom: batched ? join(reactor, 'pom.xml') : undefined,
      members: [],
    };
    group.members.push({ module, pom });
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Collects the module's subjects, aligns workspace dependencies and lists the lookups. */
function planModule(
  project: MavenProject,
  pom: PomModel,
  module: ProjectModule,
  effective: EffectiveModel,
  context: ScanContext,
): ModulePlan {
  const { poms: chain, externalParent } = project.chainOf(pom);
  const rootDir = context.rootDir;
  const subjects = new Map<string, Subject>();

  for (const dep of effective.dependencies) {
    const key = `${dep.groupId}:${dep.artifactId}`;
    if (subjects.has(key)) continue;
    const target = { groupId: dep.groupId, artifactId: dep.artifactId };
    subjects.set(key, {
      ...dep,
      scope: dep.scope === 'test' ? 'test' : 'prod',
      locate: (effectiveVersion) => locateDependencyVersion(chain, { ...target, effectiveVersion }, rootDir),
    });
  }

  // Management entries declared by this module itself, including BOM imports.
  for (const managed of pom.managedDependencies) {
    const groupId = interpolate(managed.groupId, chain);
    const artifactId = interpolate(managed.artifactId, chain);
    const key = `${groupId}:${artifactId}`;
    if (subjects.has(key) || !managed.version) continue;

    const isImport = managed.scope === 'import';
    const version = isImport
      ? interpolate(managed.version, chain)
      : effective.managedDependencies.find((m) => m.groupId === groupId && m.artifactId === artifactId)?.version;
    if (!version || version.includes('${')) continue;

    const target = { groupId, artifactId };
    subjects.set(key, {
      groupId,
      artifactId,
      version,
      type: isImport ? 'pom' : managed.type,
      classifier: managed.classifier,
      scope: 'prod',
      locate: (effectiveVersion) => locateManagedVersion(chain, { ...target, effectiveVersion }, rootDir),
    });
  }

  // An external parent POM (e.g. spring-boot-starter-parent) declared here.
  if (pom.parent && externalParent === pom.parent) {
    const { groupId, artifactId } = pom.parent;
    const version = interpolate(pom.parent.version, chain);
    subjects.set(`${groupId}:${artifactId}`, {
      groupId,
      artifactId,
      version,
      type: 'pom',
      scope: 'prod',
      locate: (effectiveVersion) => locateParentVersion(pom, { groupId, artifactId, effectiveVersion }, rootDir),
    });
  }

  const plan: ModulePlan = { module, effective, candidates: [], skipped: [], lookups: [] };
  for (const [key, subject] of subjects) {
    const origin = classifyOrigin(key, 'maven', context);
    if (origin.kind !== 'workspace') {
      plan.lookups.push({ subject, origin });
      continue;
    }

    const target = context.workspace.get(key);
    if (target && inSameReactor(module, target)) {
      if (target.version && target.version !== subject.version) {
        collect(alignmentCandidate(subject, target.version, origin), plan.candidates, plan.skipped);
      }
    } else {
      // Maven resolves a project outside the reactor from a repository, like
      // any other artifact, so a local module with the same coordinates says
      // nothing about the version the build uses.
      plan.lookups.push({ subject, origin: classifyOrigin(key, 'maven', { ...context, workspace: new Map() }) });
    }
  }
  return plan;
}

/** Two modules are in the same reactor when both are built by the same outermost aggregator. */
function inSameReactor(a: ProjectModule, b: ProjectModule): boolean {
  return a.aggregatorDir !== undefined && a.aggregatorDir === b.aggregatorDir;
}

/** Turns the version report into the module's candidates. */
function finishModule(plan: ModulePlan, report: VersionReport, channel: ReleaseChannel): ScanResult {
  const { candidates, skipped } = plan;
  for (const { subject, origin } of plan.lookups) {
    const key = `${subject.groupId}:${subject.artifactId}`;
    const newer = newerThan(subject.version, report.newerVersions.get(key) ?? []);
    const latest = pickLatest(subject.version, newer, channel);
    if (!latest) {
      if (report.failedLookups.has(key)) {
        skipped.push({ identifier: key, origin: origin.kind, reason: 'lookup-failed', detail: 'repository error' });
      }
      continue;
    }
    collect(updateCandidate(subject, latest, newer, origin), candidates, skipped);
  }

  markSharedDeclarations(candidates);
  candidates.sort((a, b) => (DIFF_ORDER[a.diff] ?? 3) - (DIFF_ORDER[b.diff] ?? 3));
  return { candidates, skipped };
}

/**
 * In a batched report an artifact appears once, with the newer versions of
 * the first module that uses it. For a module on a later version, only the
 * part of that ascending list after its own version is newer.
 */
export function newerThan(current: string, ascending: readonly string[]): string[] {
  const index = ascending.indexOf(current);
  return index >= 0 ? ascending.slice(index + 1) : [...ascending];
}

type Built = { candidate: UpdateCandidate } | { skipped: SkippedDependency };

function collect(built: Built, candidates: UpdateCandidate[], skipped: SkippedDependency[]): void {
  if ('candidate' in built) candidates.push(built.candidate);
  else skipped.push(built.skipped);
}

function updateCandidate(subject: Subject, latest: string, newer: string[], origin: DependencyOrigin): Built {
  const base = buildCandidate(subject, latest, origin, 'update');
  if ('candidate' in base) {
    base.candidate.availableVersions = [...newer].reverse().concat(subject.version);
  }
  return base;
}

function alignmentCandidate(subject: Subject, localVersion: string, origin: DependencyOrigin): Built {
  const built = buildCandidate(subject, localVersion, origin, 'align');
  if ('candidate' in built) built.candidate.availableVersions = [localVersion];
  return built;
}

function buildCandidate(
  subject: Subject,
  target: string,
  origin: DependencyOrigin,
  action: UpdateCandidate['action'],
): Built {
  const identifier = `${subject.groupId}:${subject.artifactId}`;
  const location = subject.locate(subject.version);
  if (!location.found) {
    return { skipped: { identifier, origin: origin.kind, reason: location.reason, detail: location.detail } };
  }

  const currentClean = cleanJavaVersion(subject.version) ?? '0.0.0';
  const targetClean = cleanJavaVersion(target) ?? currentClean;
  const diff = semver.eq(currentClean, targetClean) ? 'patch' : diffVersions(currentClean, targetClean);
  const isPreRelease = isPreReleaseVersion(target);

  return {
    candidate: {
      coordinate: { identifier, group: subject.groupId, artifact: subject.artifactId, ecosystem: 'maven' },
      currentRange: subject.version,
      currentClean,
      latest: target,
      newRange: target,
      diff,
      scope: subject.scope,
      selected: diff !== 'major',
      origin,
      action,
      declaration: location.declaration,
      isPreRelease,
      preReleaseTag: isPreRelease ? extractPreReleaseTag(target) : undefined,
    },
  };
}

/**
 * Picks the newest version allowed by the channel. Newer versions arrive in
 * ascending order from the report. A flavour suffix such as `-jre` or
 * `-android` (Guava) is kept when a newer version with the same flavour
 * exists, so a JRE build is not replaced by an Android build.
 */
export function pickLatest(current: string, newer: readonly string[], channel: ReleaseChannel): string | undefined {
  const allowed = newer.filter((v) => channel === 'all' || !isPreReleaseVersion(v));
  const flavour = flavourOf(current);
  const sameFlavour = flavour ? allowed.filter((v) => flavourOf(v) === flavour) : [];
  const pool = sameFlavour.length > 0 ? sameFlavour : allowed;
  return pool[pool.length - 1];
}

function flavourOf(version: string): string | undefined {
  const suffix = version.match(/-([A-Za-z]+)$/)?.[1];
  return suffix && !isPreReleaseVersion(version) ? suffix.toLowerCase() : undefined;
}

/**
 * Several artifacts often share one version property (e.g. all Jackson
 * modules). Updating one updates all of them, which the UI must show.
 */
function markSharedDeclarations(candidates: UpdateCandidate[]): void {
  const groups = new Map<string, UpdateCandidate[]>();
  for (const candidate of candidates) {
    const declaration = candidate.declaration;
    if (declaration?.kind !== 'property') continue;
    const key = `${declaration.file}#${declaration.propertyName}`;
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const candidate of group) {
      candidate.sharedWith = group
        .filter((other) => other !== candidate)
        .map((other) => other.coordinate.identifier);
    }
  }
}

