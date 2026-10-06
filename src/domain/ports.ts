/**
 * Elevate — domain ports (hexagonal architecture).
 *
 * Interfaces that decouple the domain logic from concrete package managers,
 * registries and file system operations.
 */

import type {
  ProjectModule,
  DependencyCoordinate,
  UpdateCandidate,
  UpdateSummary,
  ReleaseChannel,
  ScanResult,
} from './models.js';
import type { WorkspaceIndex } from './origin.js';

/** Port: finds all modules of an ecosystem in the repository. */
export interface ModuleDiscoveryPort {
  discover(rootDir: string): Promise<ProjectModule[]>;
  /**
   * Proposes the repository root this ecosystem would use when started in
   * `startDir`: the outermost directory it can relate `startDir` to. Only
   * `startDir` and its ancestors up to and including `boundaryDir` are
   * examined (without a boundary, up to the file-system root). Returns
   * `undefined` when the ecosystem has no opinion.
   */
  findRoot?(startDir: string, boundaryDir: string | undefined): string | undefined;
}

/** The registry a lookup would contact. */
export interface RegistryEndpoint {
  url: string;
  /** Whether the endpoint is a public registry such as npmjs.org or Maven Central. */
  isPublic: boolean;
}

/** Port: queries a registry for versions. */
export interface RegistryPort {
  /**
   * Resolves which registry a lookup for this coordinate would contact, using
   * the package manager's own configuration.
   *
   * @param cwd directory whose configuration applies (usually the repository root)
   */
  resolveEndpoint(coordinate: DependencyCoordinate, cwd: string): Promise<RegistryEndpoint>;
  getLatestVersion(
    coordinate: DependencyCoordinate,
    channel?: ReleaseChannel,
    cwd?: string,
  ): Promise<string | null>;
  /** All published versions, newest first. */
  getAllVersions(coordinate: DependencyCoordinate, cwd?: string): Promise<string[]>;
}

/** Everything a scan needs to know beyond the module itself. */
export interface ScanContext {
  rootDir: string;
  workspace: WorkspaceIndex;
  internalScopes: readonly string[];
  channel: ReleaseChannel;
}

/** Port: scans a module and returns update candidates plus skipped dependencies. */
export interface DependencyReaderPort {
  scan(module: ProjectModule, context: ScanContext): Promise<ScanResult>;
  /**
   * Optional batch scan for adapters whose tools are expensive to start
   * (Maven): several modules share the same tool runs.
   */
  scanMany?(modules: readonly ProjectModule[], context: ScanContext): Promise<Map<ProjectModule, ScanResult>>;
}

/** Outcome of writing updates and installing them. */
export type ApplyOutcome = Pick<
  UpdateSummary,
  'updatedCount' | 'auditMessage' | 'auditSeverity' | 'fundingMessage'
> & {
  /**
   * Integrity violations detected after installation, e.g. a workspace
   * dependency that npm installed from a registry instead of linking it.
   * Any violation makes the update fail and triggers a rollback.
   */
  integrityViolations: string[];
};

/** Thrown when the package manager fails to install or resolve the update. */
export class InstallError extends Error {
  constructor(message: string, readonly output?: string) {
    super(message);
    this.name = 'InstallError';
  }
}

/** Port: writes updates to manifests and installs them. */
export interface DependencyUpdaterPort {
  /**
   * Files the update may modify: manifests, lockfiles, parent POMs. They are
   * captured before the update so a failure can be rolled back.
   */
  affectedFiles(module: ProjectModule, rootDir: string, updates: UpdateCandidate[]): string[];

  /** Writes the updates and installs them. Throws `InstallError` on failure. */
  applyUpdates(
    module: ProjectModule,
    rootDir: string,
    updates: UpdateCandidate[],
    onProgress: (stepMessage: string) => void,
  ): Promise<ApplyOutcome>;

  /**
   * Brings the installed state back in line with the manifests after they were
   * restored by a rollback (e.g. re-running `npm install`).
   */
  resync(module: ProjectModule, rootDir: string, onProgress: (stepMessage: string) => void): Promise<void>;
}

export interface VerificationOptions {
  /** User-defined verification command from `postUpdateScript`. */
  customScript?: string;
  customLabel?: string;
  /** Files changed by the update; used to select the modules to rebuild. */
  changedFiles?: string[];
}

export interface VerificationResult {
  status: 'clean' | 'warn';
  details: string;
  label: string;
}

/** Port: verifies the project after an update (build, tests, consistency). */
export interface VerificationPort {
  verify(module: ProjectModule, rootDir: string, options?: VerificationOptions): Promise<VerificationResult>;
}
