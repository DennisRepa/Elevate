/**
 * A harness for scanning a Gradle module against the test double: the tree,
 * what Gradle describes, and what the repositories hold. The conventions are
 * those of specs/23 and 17: `settings.gradle` includes `app`, whose build
 * script is `app/build.gradle`; Gradle reports the usual dependency
 * `org.example:lib:1.0` in `implementation`; the repository is Maven Central.
 */

import { join } from 'node:path';
import type { ProjectModule, ReleaseChannel, ScanResult } from '../src/domain/models.js';
import { GradleDependencyAdapter } from '../src/adapters/gradle/gradle-scanner.js';
import type {
  GradleBuildDocument,
  GradleDependencyDocument,
  GradleProjectDocument,
  GradleRepositoryDocument,
} from '../src/adapters/gradle/gradle-probe.js';
import { FakeGradle, buildDoc, dep, projectDoc, repo } from './gradle-fake.js';
import { makeTree } from './helpers.js';

export interface Scenario {
  /** Files of the tree besides `settings.gradle`; `app/build.gradle` defaults to the usual literal. */
  files?: Record<string, string>;
  /** What Gradle reports for `:app`; the usual dependency by default. */
  deps?: GradleDependencyDocument[];
  constraints?: GradleProjectDocument['constraints'];
  buildscriptDependencies?: GradleProjectDocument['buildscriptDependencies'];
  repositories?: GradleRepositoryDocument[];
  buildscriptRepositories?: GradleRepositoryDocument[];
  pluginRepositories?: GradleRepositoryDocument[];
  repositoriesMode?: string | null;
  lookups?: FakeGradle['lookups'];
  defaultVersions?: string[];
  noAnswer?: string[];
  lookupFailure?: FakeGradle['lookupFailure'];
  internalScopes?: string[];
  channel?: ReleaseChannel;
  /** Further projects of the build and the included builds, given the root of the tree. */
  projects?: (root: string) => GradleProjectDocument[];
  included?: (root: string) => GradleBuildDocument[];
  /** The module to scan; `:app` by default. */
  scanned?: string[];
  /** The modules to scan, given the root of the build; overrides `scanned` (for modules of an included build). */
  modules?: (root: string) => ProjectModule[];
  /** A directory below the tree that holds the whole build (the tree itself otherwise), e.g. "R&D". */
  dir?: string;
  /** Further fields of the project documents of `:app` and `:` (tasks, project dependencies, lock flag). */
  appExtras?: Partial<GradleProjectDocument>;
  rootExtras?: Partial<GradleProjectDocument>;
}

export interface Scanned {
  root: string;
  fake: FakeGradle;
  module: ProjectModule;
  result: ScanResult;
  results: Map<ProjectModule, ScanResult>;
  modules: ProjectModule[];
}

export const USUAL_SCRIPT = "dependencies { implementation 'org.example:lib:1.0' }";

export function moduleOf(root: string, path: string, dir: string): ProjectModule {
  return {
    id: path, name: path.split(':').pop() || 'root', path: dir, relPath: dir === root ? 'Root' : dir.slice(root.length + 1),
    ecosystem: 'gradle', isRoot: dir === root, buildDir: root, buildRoot: root, buildKind: 'root',
  };
}

export async function scan(fake: FakeGradle, scenario: Scenario = {}): Promise<Scanned> {
  const prefix = scenario.dir ? `${scenario.dir}/` : '';
  const files = { 'settings.gradle': "include 'app'", 'app/build.gradle': USUAL_SCRIPT, ...scenario.files };
  const top = makeTree(Object.fromEntries(Object.entries(files).map(([file, text]) => [`${prefix}${file}`, text])));
  const root = scenario.dir ? join(top, scenario.dir) : top;
  const app = projectDoc(':app', join(root, 'app'), {
    group: null,
    repositories: scenario.repositories ?? [repo('MavenRepo')],
    buildscriptRepositories: scenario.buildscriptRepositories ?? [],
    dependencies: scenario.deps ?? [dep('implementation', 'org.example:lib:1.0')],
    constraints: scenario.constraints ?? [],
    buildscriptDependencies: scenario.buildscriptDependencies ?? [],
    ...scenario.appExtras,
  });
  const projects = [
    projectDoc(':', root, { group: null, buildFile: join(root, 'build.gradle'), ...scenario.rootExtras }),
    app,
    ...(scenario.projects?.(root) ?? []),
  ];
  fake.documents = [
    buildDoc('mono', root, projects, {
      repositoriesMode: scenario.repositoriesMode ?? null,
      pluginRepositories: scenario.pluginRepositories ?? [],
    }),
    ...(scenario.included?.(root) ?? []),
  ];
  fake.defaultVersions = scenario.defaultVersions ?? ['1.0', '1.1'];
  Object.assign(fake.lookups, scenario.lookups);
  for (const key of scenario.noAnswer ?? []) fake.noAnswer.add(key);
  fake.lookupFailure = scenario.lookupFailure;

  const wanted = scenario.scanned ?? [':app'];
  const modules =
    scenario.modules?.(root) ??
    wanted.map((path) => moduleOf(root, path, path === ':' ? root : join(root, path.slice(1).replace(/:/g, '/'))));
  const context = {
    rootDir: root,
    workspace: new Map(),
    internalScopes: scenario.internalScopes ?? [],
    channel: scenario.channel ?? ('stable' as ReleaseChannel),
  };
  const adapter = new GradleDependencyAdapter();
  const results = await adapter.scanMany(modules, context);
  const module = modules[0]!;
  return { root, fake, module, modules, result: results.get(module)!, results };
}

/** The candidate for an identifier. */
export function candidate(scanned: Scanned, identifier: string) {
  return scanned.result.candidates.find((c) => c.coordinate.identifier === identifier);
}

/** The coordinates a lookup run was asked about, as `group:name`. */
export function plannedLookups(fake: FakeGradle): string[] {
  return fake.plans.flatMap((plan) => plan.lookups.map((l) => `${l.group}:${l.name}`));
}
