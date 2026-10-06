/**
 * Elevate — domain models and value objects.
 *
 * Pure data types without framework or I/O dependencies.
 */

/** Supported ecosystems / package managers. */
export type Ecosystem = 'npm' | 'maven';

/** A module (npm workspace, Maven project) inside the repository. */
export interface ProjectModule {
  /** Unique identifier: the package name (npm) or `groupId:artifactId` (Maven). */
  id: string;
  /** Display name for the UI. */
  name: string;
  /** Absolute path of the module directory. */
  path: string;
  /** Path relative to the repository root (`Root` for the root itself). */
  relPath: string;
  ecosystem: Ecosystem;
  /** Whether this module is the repository root. */
  isRoot: boolean;
  /**
   * The module's own version as declared in the repository, if it can be
   * determined statically. Used as the alignment target for internal
   * dependencies on this module.
   */
  version?: string;
  /**
   * Maven only: directory of the aggregator POM whose reactor builds this
   * module. Verification runs from there so dependent modules are rebuilt.
   */
  aggregatorDir?: string;
}

/** Value object: the coordinates of a dependency. */
export interface DependencyCoordinate {
  /** Full identifier (npm: package name; Maven: `groupId:artifactId`). */
  identifier: string;
  /** Namespace / groupId (Maven only). */
  group?: string;
  /** Artifact or package name. */
  artifact: string;
  ecosystem: Ecosystem;
}

/**
 * Where a dependency comes from. Decides which version source is consulted
 * and which registry may be contacted for it.
 *
 * - `workspace`: another module of this repository. Its version is defined
 *   locally; the target is always the module's local version.
 * - `private`: an internal package published to a private registry, identified
 *   by the configured `internalScopes` or an explicit scoped registry mapping.
 *   It must never be looked up on a public registry.
 * - `public`: everything else.
 */
export type DependencyOrigin =
  | { kind: 'workspace'; moduleId: string; moduleRelPath: string }
  | { kind: 'private'; matchedBy: 'internal-scope' | 'scoped-registry'; registry?: string }
  | { kind: 'public' };

export type DependencyOriginKind = DependencyOrigin['kind'];

/** Release channel: stable releases only, or including pre-releases. */
export type ReleaseChannel = 'stable' | 'all';

/** Kind of version change according to SemVer. */
export type VersionDiff = 'patch' | 'minor' | 'major';

/**
 * The exact place in a manifest that holds a version literal. An update is
 * written there, which may be a different file than the module's own
 * manifest (e.g. a property in a parent POM).
 */
export interface VersionDeclaration {
  /** Absolute path of the manifest that contains the literal. */
  file: string;
  kind: 'dependency' | 'dependency-management' | 'parent' | 'property';
  /** Name of the property holding the version (kind `property`). */
  propertyName?: string;
  /** Path of `file` relative to the repository root, for display. */
  displayPath: string;
}

/** Entity: a dependency for which a newer or aligned version is available. */
export interface UpdateCandidate {
  coordinate: DependencyCoordinate;
  /** Version range or version as currently written in the manifest. */
  currentRange: string;
  /** Normalised current version. */
  currentClean: string;
  /** Target version offered by the version source. */
  latest: string;
  /** Range or version that will be written. */
  newRange: string;
  diff: VersionDiff;
  /** Dependency type: prod, dev (npm), test, plugin (Maven). */
  scope: 'prod' | 'dev' | 'test' | 'plugin';
  /** Selected for update in the dashboard. */
  selected: boolean;
  /** Where the dependency comes from. */
  origin: DependencyOrigin;
  /**
   * `update`: move to a newer version from a registry.
   * `align`: move to the local version of a workspace module.
   */
  action: 'update' | 'align';
  /** Where the version is written (Maven); undefined means the module manifest. */
  declaration?: VersionDeclaration;
  /** Other dependencies sharing the same declaration (e.g. one version property). */
  sharedWith?: string[];
  /**
   * Versions a user may pick from, newest first, when the version source
   * already provided them (Maven reports, workspace alignment). When absent,
   * the registry is queried on demand.
   */
  availableVersions?: string[];
  /** Whether the target is a pre-release (alpha, beta, RC, milestone, snapshot). */
  isPreRelease?: boolean;
  /** Short pre-release label, e.g. "BETA", "RC", "M2". */
  preReleaseTag?: string;
  /** Whether the target version was picked manually. */
  isCustomVersion?: boolean;
}

/** Why a dependency could not be offered although it may be outdated. */
export type SkipReason =
  /** Internal package whose registry resolves to a public registry. */
  | 'private-on-public-registry'
  /** The registry lookup failed (network, authentication, server error). */
  | 'lookup-failed'
  /** The version is declared outside the repository (external parent or BOM). */
  | 'managed-externally'
  /** The declared version does not match the resolved one (profiles, CLI overrides). */
  | 'declaration-mismatch'
  /** The name is not a valid package identifier and was not passed to any tool. */
  | 'invalid-name';

/** A dependency that was deliberately not offered, with the reason. */
export interface SkippedDependency {
  identifier: string;
  origin: DependencyOriginKind;
  reason: SkipReason;
  detail?: string;
}

/** Result of scanning one module. */
export interface ScanResult {
  candidates: UpdateCandidate[];
  skipped: SkippedDependency[];
}

/** Value object: counters for the UI. */
export interface SelectionCounts {
  total: number;
  prodCount: number;
  devCount: number;
  selectedCount: number;
  patchCount: number;
  minorCount: number;
  majorCount: number;
}

/** Value object: report of an update run. */
export interface UpdateSummary {
  /** Number of dependencies written. */
  updatedCount: number;
  /** Install / resolution status message. */
  auditMessage: string;
  auditSeverity: 'clean' | 'warn';
  /** Optional funding hint (npm). */
  fundingMessage?: string;
  verificationStatus?: 'clean' | 'warn';
  verificationDetails?: string;
  verificationLabel?: string;
  /** Whether all changes were reverted because a step failed. */
  rolledBack?: boolean;
  /** Why the update failed, if it did. */
  failure?: string;
  /** Files that were modified (and kept). */
  changedFiles?: string[];
}

/** Dashboard views (finite state machine). */
export type View =
  | 'splash'
  | 'dashboard'
  | 'workspace_modal'
  | 'version_modal'
  | 'updating'
  | 'summary';

/** Active tab in the package list. */
export type Tab = 'all' | 'prod' | 'dev';
