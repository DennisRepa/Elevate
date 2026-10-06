/**
 * Elevate — scan use case shared by the TUI, the CLI and the MCP server.
 */

import type { ElevateConfig } from '../config.js';
import type { ProjectModule, ReleaseChannel, ScanResult, UpdateCandidate } from '../domain/models.js';
import type { EcosystemStrategy } from '../domain/ecosystem-strategy.js';
import type { ScanContext } from '../domain/ports.js';
import { buildWorkspaceIndex } from '../domain/origin.js';

/** Builds the scan context for a set of discovered modules. */
export function createScanContext(
  modules: readonly ProjectModule[],
  config: Pick<ElevateConfig, 'rootDir' | 'internalScopes'>,
  channel: ReleaseChannel,
): ScanContext {
  return {
    rootDir: config.rootDir,
    workspace: buildWorkspaceIndex(modules),
    internalScopes: config.internalScopes,
    channel,
  };
}

/**
 * Finds a module by id, relative path or path suffix (case-insensitive).
 * Returns undefined when nothing matches.
 */
export function findModule(modules: readonly ProjectModule[], query: string): ProjectModule | undefined {
  const needle = query.toLowerCase().replace(/\\/g, '/');
  return modules.find(
    (m) =>
      m.id.toLowerCase() === needle ||
      m.relPath.toLowerCase() === needle ||
      m.path.toLowerCase().replace(/\\/g, '/').endsWith(needle),
  );
}

/** Scans a module and converts unexpected errors into a readable message. */
export async function scanModule(
  strategy: EcosystemStrategy,
  module: ProjectModule,
  context: ScanContext,
): Promise<ScanResult & { error?: string }> {
  try {
    return await strategy.reader.scan(module, context);
  } catch (err) {
    return { candidates: [], skipped: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Scans several modules, using the adapter's batch scan when it has one. If a
 * batch fails, every module of it reports the error.
 */
export async function scanModules(
  strategy: EcosystemStrategy,
  modules: readonly ProjectModule[],
  context: ScanContext,
): Promise<Map<ProjectModule, ScanResult & { error?: string }>> {
  const results = new Map<ProjectModule, ScanResult & { error?: string }>();
  if (modules.length > 1 && strategy.reader.scanMany) {
    try {
      const batch = await strategy.reader.scanMany(modules, context);
      for (const module of modules) results.set(module, batch.get(module) ?? { candidates: [], skipped: [] });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      for (const module of modules) results.set(module, { candidates: [], skipped: [], error });
    }
    return results;
  }
  for (const module of modules) results.set(module, await scanModule(strategy, module, context));
  return results;
}

/** JSON shape of a candidate for CLI and MCP output. */
export function candidateToJson(u: UpdateCandidate) {
  return {
    identifier: u.coordinate.identifier,
    action: u.action,
    origin: u.origin.kind,
    currentRange: u.currentRange,
    currentClean: u.currentClean,
    latest: u.latest,
    newRange: u.newRange,
    diff: u.diff,
    scope: u.scope,
    isPreRelease: u.isPreRelease ?? false,
    preReleaseTag: u.preReleaseTag,
    declaredIn: u.declaration
      ? { file: u.declaration.displayPath, kind: u.declaration.kind, property: u.declaration.propertyName }
      : undefined,
    sharedWith: u.sharedWith,
  };
}
