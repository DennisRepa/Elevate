/**
 * Elevate — Gradle dependency scanner.
 *
 * For each requested module:
 *  1. Gradle describes the build: the dependencies a project declares with the
 *     version each has after every script has run (one describe run per build
 *     directory, however many modules are requested).
 *  2. A dependency is not a subject when it has no version, is a project or a
 *     file dependency, or is substituted by a project of an included build
 *     (that one is aligned to the project's version). What carries a selector
 *     or a constraint, or whose version text cannot be located with certainty,
 *     is listed as not offered with the reason.
 *  3. Everything else is looked up through the repositories of the build with
 *     one lookup run per build directory. Elevate never contacts a repository
 *     itself, and an internal package is never asked of a public one.
 *
 * Specs 16 (what is offered and where the version is written) and 17 (the
 * versions, the repositories and the guard).
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import semver from 'semver';
import type { DependencyReaderPort, ScanContext } from '../../domain/ports.js';
import type {
  DependencyOrigin,
  DependencyOriginKind,
  ProjectModule,
  ReleaseChannel,
  ScanResult,
  SkippedDependency,
  UpdateCandidate,
} from '../../domain/models.js';
import { classifyOrigin } from '../../domain/origin.js';
import { cleanJavaVersion, diffVersions, extractPreReleaseTag, isPreReleaseVersion } from '../../domain/versions.js';
import { gradleModuleId } from './gradle-discovery.js';
import { assessDependency, isTestConfiguration, locateDeclarations } from './gradle-locator.js';
import type { LocatedDeclaration } from './gradle-locator.js';
import { runDescribe, runLookup } from './gradle-probe.js';
import type { GradleBuildDocument, GradleProjectDocument, LookupResultDocument } from './gradle-probe.js';
import {
  buildLookupPlan,
  effectiveRepositories,
  isPublicRepositoryUrl,
  lookupFailureDetail,
  stripCredentials,
} from './gradle-repositories.js';
import type { BuiltPlan, LookupRequest } from './gradle-repositories.js';
import { isNewerGradleVersion, sortGradleVersions } from './gradle-versions.js';

const DIFF_ORDER: Record<string, number> = { major: 0, minor: 1, patch: 2 };
const SCOPE_ORDER: Record<UpdateCandidate['scope'], number> = { prod: 0, test: 1, dev: 1, plugin: 2 };

/** One declaration Gradle reports for a coordinate. */
interface Entry {
  group: string | null;
  name: string;
  version: string | null;
  strictly: string | null;
  preferred: string | null;
  rejected: readonly string[];
  scope: UpdateCandidate['scope'];
  fromCatalog: boolean;
  isConstraint: boolean;
  isPlugin: boolean;
}

/** A coordinate the module declares, with everything needed to look it up. */
interface Subject {
  identifier: string;
  group: string;
  name: string;
  version: string;
  scope: UpdateCandidate['scope'];
  isPlugin: boolean;
  declarations: LocatedDeclaration[];
}

interface LookupItem {
  subject: Subject;
  origin: DependencyOrigin;
  request: LookupRequest;
}

/** A module whose dependencies are known but not yet looked up. */
interface ModulePlan {
  module: ProjectModule;
  candidates: UpdateCandidate[];
  skipped: SkippedDependency[];
  lookups: LookupItem[];
}

export class GradleDependencyAdapter implements DependencyReaderPort {
  async scan(module: ProjectModule, context: ScanContext): Promise<ScanResult> {
    const results = await this.scanMany([module], context);
    return results.get(module) ?? { candidates: [], skipped: [] };
  }

  /**
   * Modules of one Gradle build directory share one describe run and one
   * lookup run: Gradle starts slowly, so the runs are not repeated per module.
   */
  async scanMany(modules: readonly ProjectModule[], context: ScanContext): Promise<Map<ProjectModule, ScanResult>> {
    const groups = new Map<string, ProjectModule[]>();
    for (const module of modules) {
      const dir = module.buildDir ?? module.path;
      groups.set(dir, [...(groups.get(dir) ?? []), module]);
    }

    const results = new Map<ProjectModule, ScanResult>();
    for (const [dir, members] of groups) {
      for (const [module, result] of await scanGroup(dir, members, context)) results.set(module, result);
    }
    return results;
  }
}

async function scanGroup(
  dir: string,
  modules: readonly ProjectModule[],
  context: ScanContext,
): Promise<Map<ProjectModule, ScanResult>> {
  const documents = await runDescribe(dir, context.rootDir);
  const files = new FileReader();

  const plans: ModulePlan[] = [];
  for (const module of modules) {
    const build = documents.find((doc) => sameDir(doc.build.dir, module.buildRoot ?? dir));
    const project = build?.projects.find((p) => sameDir(p.dir, module.path));
    if (!build || !project) {
      plans.push({ module, candidates: [], skipped: [], lookups: [] });
      continue;
    }
    plans.push(planModule(module, build, project, documents, context, files));
  }

  const requests = plans.flatMap((plan) => plan.lookups.map((item) => item.request));
  let built: BuiltPlan | undefined;
  let results: LookupResultDocument[] = [];
  if (requests.length > 0) {
    built = buildLookupPlan(requests, context.internalScopes);
    results = await runLookup(dir, context.rootDir, built.plan);
  }

  const answers = new Answers(results);
  return new Map(plans.map((plan) => [plan.module, finishModule(plan, built, answers, context.channel)]));
}

class FileReader {
  private readonly cache = new Map<string, string | undefined>();
  read = (file: string): string | undefined => {
    if (!this.cache.has(file)) this.cache.set(file, existsSync(file) ? readFileSync(file, 'utf8') : undefined);
    return this.cache.get(file);
  };
}

function canonical(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return resolve(dir);
  }
}

function sameDir(a: string, b: string): boolean {
  return canonical(a) === canonical(b);
}

function isOutside(rootDir: string, dir: string): boolean {
  const path = relative(canonical(rootDir), canonical(dir));
  return path.startsWith('..') || resolve(path) === path;
}

// ---- planning -------------------------------------------------------------------------

/** The declarations Gradle reports for the project, grouped by coordinate. */
function entriesOf(project: GradleProjectDocument): Map<string, Entry[]> {
  const groups = new Map<string, Entry[]>();
  const add = (key: string, entry: Entry): void => {
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  };
  const keyOf = (entry: Entry): string =>
    entry.isPlugin ? `plugin:${entry.group}` : `${entry.group ?? ''}:${entry.name}`;

  for (const dep of project.dependencies) {
    const entry: Entry = {
      group: dep.group,
      name: dep.name,
      version: dep.version,
      strictly: dep.strictly,
      preferred: dep.preferred,
      rejected: dep.rejected,
      scope: isTestConfiguration(dep.configuration) ? 'test' : 'prod',
      fromCatalog: dep.fromCatalog,
      isConstraint: false,
      isPlugin: false,
    };
    add(keyOf(entry), entry);
  }
  for (const constraint of project.constraints) {
    const entry: Entry = {
      group: constraint.group,
      name: constraint.name,
      version: constraint.version,
      strictly: constraint.strictly,
      preferred: null,
      rejected: [],
      scope: isTestConfiguration(constraint.configuration) ? 'test' : 'prod',
      fromCatalog: false,
      isConstraint: true,
      isPlugin: false,
    };
    add(keyOf(entry), entry);
  }
  for (const dep of project.buildscriptDependencies) {
    // `plugins { id 'x' version 'v' }` is reported as the marker `x:x.gradle.plugin:v`.
    const isPlugin = dep.group !== null && dep.name === `${dep.group}.gradle.plugin`;
    const entry: Entry = {
      group: dep.group,
      name: dep.name,
      version: dep.version,
      strictly: null,
      preferred: null,
      rejected: [],
      scope: 'plugin',
      fromCatalog: false,
      isConstraint: false,
      isPlugin,
    };
    add(keyOf(entry), entry);
  }
  return groups;
}

/** The projects of the included builds, by `group:name`: Gradle substitutes a dependency on them. */
function substitutions(
  documents: readonly GradleBuildDocument[],
  own: GradleBuildDocument,
): Map<string, { build: GradleBuildDocument; project: GradleProjectDocument }> {
  const table = new Map<string, { build: GradleBuildDocument; project: GradleProjectDocument }>();
  for (const build of documents) {
    if (build.build.kind !== 'included' || sameDir(build.build.dir, own.build.dir)) continue;
    for (const project of build.projects) {
      if (project.group) table.set(`${project.group}:${project.name}`, { build, project });
    }
  }
  return table;
}

function planModule(
  module: ProjectModule,
  build: GradleBuildDocument,
  project: GradleProjectDocument,
  documents: readonly GradleBuildDocument[],
  context: ScanContext,
  files: FileReader,
): ModulePlan {
  const plan: ModulePlan = { module, candidates: [], skipped: [], lookups: [] };
  const table = substitutions(documents, build);
  const skip = (identifier: string, origin: DependencyOriginKind, reason: SkippedDependency['reason'], detail?: string) =>
    plan.skipped.push({ identifier, origin, reason, detail });

  for (const entries of entriesOf(project).values()) {
    const first = entries[0]!;
    const identifier = first.isPlugin ? first.group! : first.group ? `${first.group}:${first.name}` : first.name;
    const versioned = entries.filter((e) => e.version !== null && e.version.trim() !== '');
    if (versioned.length === 0) continue; // a platform, a constraint or a plugin manages the version
    const originKind = classifyOrigin(identifier, 'gradle', { workspace: new Map(), internalScopes: context.internalScopes }).kind;

    // Nothing is offered that carries a selector or a constraint, or that has no group.
    const unusable = versioned
      .map((e) => assessDependency({ group: e.group, name: e.name, version: e.version, strictly: e.strictly, preferred: e.preferred, rejected: e.rejected }))
      .find((assessment) => assessment.action === 'skip');
    if (unusable && unusable.action === 'skip') {
      skip(identifier, originKind, unusable.reason, unusable.detail);
      continue;
    }

    // The main declaration: the first of prod, test, plugin; its version is the current one.
    const main = [...versioned].sort((a, b) => SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope])[0]!;
    const group = main.group!;
    const subject: Omit<Subject, 'declarations'> = {
      identifier,
      group,
      name: main.name,
      version: main.version!,
      scope: main.scope,
      isPlugin: main.isPlugin,
    };

    // A dependency on a project of an included build is substituted by Gradle (fact 15).
    const target = main.isPlugin ? undefined : table.get(`${group}:${main.name}`);
    if (target) {
      const local = target.project.version;
      const reported = !local || local === 'unspecified' ? undefined : local;
      if (!reported || reported === subject.version || isOutside(context.rootDir, target.project.dir)) continue;
      const located = locateAll(entries, subject, build, project, context, files);
      if (!located.ok) {
        skip(identifier, 'workspace', 'declaration-mismatch', located.detail);
        continue;
      }
      const origin: DependencyOrigin = {
        kind: 'workspace',
        moduleId: gradleModuleId(target.build.build, target.project, false),
        moduleRelPath: relative(canonical(context.rootDir), canonical(target.project.dir)).replace(/\\/g, '/'),
      };
      const candidate = buildCandidate({ ...subject, declarations: located.declarations }, reported, origin, 'align');
      candidate.availableVersions = [reported];
      plan.candidates.push(candidate);
      continue;
    }

    const origin = classifyOrigin(subject.identifier, 'gradle', {
      workspace: new Map(),
      internalScopes: context.internalScopes,
    });

    const located = locateAll(entries, subject, build, project, context, files);
    if (!located.ok) {
      skip(identifier, origin.kind, 'declaration-mismatch', located.detail);
      continue;
    }

    const kind = main.isPlugin ? 'plugin' : 'module';
    const repositories = effectiveRepositories(build.build, project, kind);
    if (repositories.length === 0) {
      skip(identifier, origin.kind, 'lookup-failed', `the build declares no repository for ${project.path}`);
      continue;
    }
    if (origin.kind === 'private' && repositories.every((r) => isPublicRepositoryUrl(r.url))) {
      skip(identifier, origin.kind, 'private-on-public-registry', stripCredentials(repositories[0]!.url ?? ''));
      continue;
    }

    plan.lookups.push({
      subject: { ...subject, declarations: located.declarations },
      origin,
      request: {
        buildRoot: build.build.dir,
        project: project.path,
        kind,
        group,
        name: main.isPlugin ? `${group}.gradle.plugin` : main.name,
        repositories,
      },
    });
  }
  return plan;
}

/**
 * Finds every place the coordinate's version is written. A coordinate that is
 * declared with different versions (a test configuration still on the old one)
 * is searched for each version, so the new one is written to all of them.
 */
function locateAll(
  entries: readonly Entry[],
  subject: Omit<Subject, 'declarations'>,
  build: GradleBuildDocument,
  project: GradleProjectDocument,
  context: ScanContext,
  files: FileReader,
): { ok: true; declarations: LocatedDeclaration[] } | { ok: false; detail: string } {
  const versions = [subject.version, ...new Set(entries.map((e) => e.version).filter((v): v is string => !!v && v !== subject.version))];
  const declarations: LocatedDeclaration[] = [];
  for (const version of versions) {
    const same = entries.filter((e) => e.version === version);
    const result = locateDeclarations({
      rootDir: context.rootDir,
      build: build.build,
      project,
      projects: build.projects,
      group: subject.group,
      name: subject.name,
      version,
      isPlugin: subject.isPlugin,
      viaScripts: subject.isPlugin || same.some((e) => !e.fromCatalog),
      viaCatalog: same.some((e) => e.fromCatalog),
      read: files.read,
    });
    if (!result.ok) return result;
    declarations.push(...result.declarations);
  }

  // The same text is listed once; a constraint is never the main declaration.
  const seen = new Set<string>();
  const unique = declarations.filter((d) => {
    const key = `${d.file}:${d.range.start}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => Number(a.kind === 'dependency-management') - Number(b.kind === 'dependency-management'));
  return { ok: true, declarations: unique };
}

// ---- finishing --------------------------------------------------------------------------

/** What the lookup run answered, by the id of its plan entry. */
class Answers {
  private readonly byId = new Map<string, LookupResultDocument>();
  /** The detail of the first failed lookup of the run: the cause behind "disabled due to earlier error". */
  readonly firstFailure: string | undefined;

  constructor(results: readonly LookupResultDocument[]) {
    for (const result of results) this.byId.set(result.id, result);
    this.firstFailure = results
      .filter((r) => r.error !== null)
      .map((r) => lookupFailureDetail(r.error!, undefined))
      .find((detail) => detail.isCause)?.text;
  }

  get(id: string): LookupResultDocument | undefined {
    return this.byId.get(id);
  }
}

function finishModule(plan: ModulePlan, built: BuiltPlan | undefined, answers: Answers, channel: ReleaseChannel): ScanResult {
  const { candidates, skipped } = plan;
  for (const { subject, origin, request } of plan.lookups) {
    const answer = built ? answers.get(built.idOf(request)) : undefined;
    if (!answer) {
      skipped.push({ identifier: subject.identifier, origin: origin.kind, reason: 'lookup-failed', detail: 'Gradle gave no answer for this lookup.' });
      continue;
    }
    if (answer.error !== null) {
      const detail = lookupFailureDetail(answer.error, answers.firstFailure).text;
      skipped.push({ identifier: subject.identifier, origin: origin.kind, reason: 'lookup-failed', detail });
      continue;
    }

    const newer = sortGradleVersions(answer.versions).filter((v) => isNewerGradleVersion(v, subject.version));
    const latest = pickLatest(subject.version, newer, channel);
    if (!latest) continue; // nothing newer, or the coordinate is unknown: neither is an error
    const candidate = buildCandidate(subject, latest, origin, 'update');
    candidate.availableVersions = [...newer, subject.version];
    candidates.push(candidate);
  }

  markSharedDeclarations(candidates);
  candidates.sort((a, b) => (DIFF_ORDER[a.diff] ?? 3) - (DIFF_ORDER[b.diff] ?? 3));
  return { candidates, skipped };
}

function buildCandidate(subject: Subject, target: string, origin: DependencyOrigin, action: UpdateCandidate['action']): UpdateCandidate {
  const currentClean = cleanJavaVersion(subject.version) ?? '0.0.0';
  const targetClean = cleanJavaVersion(target) ?? currentClean;
  const diff = semver.eq(currentClean, targetClean) ? 'patch' : diffVersions(currentClean, targetClean);
  const isPreRelease = isPreReleaseVersion(target);

  return {
    coordinate: {
      identifier: subject.identifier,
      group: subject.group,
      artifact: subject.isPlugin ? `${subject.group}.gradle.plugin` : subject.name,
      ecosystem: 'gradle',
    },
    currentRange: subject.version,
    currentClean,
    latest: target,
    newRange: target,
    diff,
    scope: subject.scope,
    selected: diff !== 'major',
    origin,
    action,
    declaration: subject.declarations[0],
    declarations: subject.declarations,
    isPreRelease,
    preReleaseTag: isPreRelease ? extractPreReleaseTag(target) : undefined,
  };
}

/**
 * Picks the newest version the channel allows from the newer versions, newest
 * first. A flavour suffix such as `-jre` or `-android` (Guava) is kept when a
 * newer version with the same flavour exists.
 */
export function pickLatest(current: string, newer: readonly string[], channel: ReleaseChannel): string | undefined {
  const allowed = newer.filter((v) => channel === 'all' || !isPreReleaseVersion(v));
  const flavour = flavourOf(current);
  const sameFlavour = flavour ? allowed.filter((v) => flavourOf(v) === flavour) : [];
  return (sameFlavour.length > 0 ? sameFlavour : allowed)[0];
}

function flavourOf(version: string): string | undefined {
  const suffix = version.match(/-([A-Za-z]+)$/)?.[1];
  return suffix && !isPreReleaseVersion(version) ? suffix.toLowerCase() : undefined;
}

/**
 * Several dependencies often share one property or one catalog version (all
 * Jackson modules, the slf4j artifacts). Updating one updates all of them,
 * which the UI must show.
 */
function markSharedDeclarations(candidates: UpdateCandidate[]): void {
  const users = new Map<string, UpdateCandidate[]>();
  for (const candidate of candidates) {
    for (const declaration of candidate.declarations ?? []) {
      if (declaration.kind !== 'property' && declaration.kind !== 'catalog') continue;
      const key = `${declaration.file}:${declaration.range?.start}`;
      const list = users.get(key) ?? [];
      if (!list.includes(candidate)) users.set(key, [...list, candidate]);
    }
  }
  for (const group of users.values()) {
    if (group.length < 2) continue;
    for (const candidate of group) {
      const others = group.filter((other) => other !== candidate).map((other) => other.coordinate.identifier);
      candidate.sharedWith = [...new Set([...(candidate.sharedWith ?? []), ...others])];
    }
  }
}
