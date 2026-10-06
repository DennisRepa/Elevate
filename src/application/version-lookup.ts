/**
 * Elevate — ad-hoc version lookups (`elevate versions`, MCP, version picker).
 *
 * Applies the same rule as the scanners: an internal package is never looked
 * up on a public registry, because the request itself would reveal the
 * internal name and invite a dependency-confusion attack.
 */

import type { ElevateConfig } from '../config.js';
import type { DependencyCoordinate, Ecosystem } from '../domain/models.js';
import type { EcosystemStrategy } from '../domain/ecosystem-strategy.js';
import { matchesInternalScope } from '../domain/origin.js';

/** Thrown when a lookup would send an internal package name to a public registry. */
export class PublicLookupRefusedError extends Error {
  constructor(identifier: string, registry: string) {
    super(
      `'${identifier}' is an internal package (internalScopes) and its lookup would go to the public registry ${registry}. ` +
        'Configure a private registry for it instead.',
    );
    this.name = 'PublicLookupRefusedError';
  }
}

/** Builds a coordinate from a CLI-style identifier (`name` or `groupId:artifactId`). */
export function coordinateFromIdentifier(identifier: string, ecosystem: Ecosystem): DependencyCoordinate {
  if (ecosystem === 'maven') {
    const [group, artifact] = identifier.split(':');
    return { identifier, group, artifact: artifact || group!, ecosystem };
  }
  return { identifier, artifact: identifier, ecosystem };
}

/** All published versions (newest first), refusing public lookups of internal packages. */
export async function lookupVersions(
  strategy: EcosystemStrategy,
  coordinate: DependencyCoordinate,
  config: Pick<ElevateConfig, 'rootDir' | 'internalScopes'>,
): Promise<string[]> {
  if (matchesInternalScope(coordinate.identifier, coordinate.ecosystem, config.internalScopes)) {
    const endpoint = await strategy.registry.resolveEndpoint(coordinate, config.rootDir);
    if (endpoint.isPublic) throw new PublicLookupRefusedError(coordinate.identifier, endpoint.url);
  }
  return strategy.registry.getAllVersions(coordinate, config.rootDir);
}
