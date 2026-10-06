/**
 * Elevate — dependency origin classification.
 *
 * Decides whether a dependency is a workspace module, an internal package from
 * a private registry, or a public package. The registry URL alone is not a
 * reliable signal: in most companies every request — public packages included
 * — goes through one Artifactory or Nexus proxy. The classification therefore
 * relies on what is explicitly known: the modules found in the repository,
 * the configured internal scopes, and explicit per-scope registry mappings.
 */

import type { DependencyOrigin, Ecosystem, ProjectModule } from './models.js';

/** Index of the repository's own modules, keyed by dependency identifier. */
export type WorkspaceIndex = ReadonlyMap<string, ProjectModule>;

export interface OriginContext {
  workspace: WorkspaceIndex;
  /** Configured internal scopes / groupId prefixes (e.g. `@my-org`, `com.mycompany`). */
  internalScopes: readonly string[];
  /** npm only: explicit `@scope:registry` mappings from the npm configuration. */
  scopedRegistries?: ReadonlyMap<string, string>;
}

/** Builds the workspace index from discovered modules. */
export function buildWorkspaceIndex(modules: readonly ProjectModule[]): WorkspaceIndex {
  const index = new Map<string, ProjectModule>();
  for (const module of modules) {
    if (module.id && module.id !== 'empty') index.set(module.id, module);
  }
  return index;
}

export function classifyOrigin(
  identifier: string,
  ecosystem: Ecosystem,
  context: OriginContext,
): DependencyOrigin {
  const module = context.workspace.get(identifier);
  if (module) {
    return { kind: 'workspace', moduleId: module.id, moduleRelPath: module.relPath };
  }

  if (matchesInternalScope(identifier, ecosystem, context.internalScopes)) {
    return { kind: 'private', matchedBy: 'internal-scope' };
  }

  if (ecosystem === 'npm' && context.scopedRegistries) {
    const scope = npmScopeOf(identifier);
    const registry = scope ? context.scopedRegistries.get(scope) : undefined;
    if (registry) return { kind: 'private', matchedBy: 'scoped-registry', registry };
  }

  return { kind: 'public' };
}

/**
 * Checks an identifier against the configured internal scopes.
 *
 * npm: `@scope` (or `@scope/`) matches every package in that scope; any other
 * entry matches the exact package name, or a name prefix when it ends in `*`.
 *
 * Maven: an entry matches the groupId itself and every groupId below it on a
 * segment boundary — `com.acme` matches `com.acme` and `com.acme.billing`, but
 * not `com.acmecorp`. A leading `@` is ignored so one shared list can serve
 * both ecosystems.
 */
export function matchesInternalScope(
  identifier: string,
  ecosystem: Ecosystem,
  internalScopes: readonly string[],
): boolean {
  if (ecosystem === 'maven') {
    const groupId = identifier.split(':')[0] ?? '';
    return internalScopes.some((entry) => {
      const prefix = entry.replace(/^@/, '').replace(/[.:/]+$/, '');
      return prefix.length > 0 && (groupId === prefix || groupId.startsWith(`${prefix}.`));
    });
  }

  return internalScopes.some((entry) => {
    if (entry.startsWith('@')) {
      const scope = entry.replace(/\/+$/, '');
      return identifier.startsWith(`${scope}/`);
    }
    if (entry.endsWith('*')) return identifier.startsWith(entry.slice(0, -1));
    return identifier === entry;
  });
}

/** Returns the `@scope` part of a scoped npm package name. */
export function npmScopeOf(name: string): string | undefined {
  if (!name.startsWith('@')) return undefined;
  const slash = name.indexOf('/');
  return slash > 1 ? name.slice(0, slash) : undefined;
}
