/**
 * Elevate — npm configuration reader.
 *
 * Reads the effective npm configuration through `npm config list --json`, so
 * every source npm itself honours (project, user and global `.npmrc`,
 * environment variables) is taken into account without re-implementing npm's
 * precedence rules.
 */

import { runCommand } from '../shared/process.js';
import { npmScopeOf } from '../../domain/origin.js';

export interface NpmRegistryConfig {
  /** Default registry for unscoped packages and scopes without a mapping. */
  registry: string;
  /** Explicit `@scope:registry` mappings. */
  scopedRegistries: ReadonlyMap<string, string>;
}

const DEFAULT_REGISTRY = 'https://registry.npmjs.org/';

/** Hosts of public npm registries. */
const PUBLIC_NPM_HOSTS = new Set(['registry.npmjs.org', 'registry.npmjs.com', 'registry.yarnpkg.com']);

export class NpmConfigReader {
  private readonly cache = new Map<string, Promise<NpmRegistryConfig>>();

  /** Returns the registry configuration that applies in `cwd` (cached per directory). */
  read(cwd: string): Promise<NpmRegistryConfig> {
    let pending = this.cache.get(cwd);
    if (!pending) {
      pending = loadConfig(cwd);
      this.cache.set(cwd, pending);
    }
    return pending;
  }

  /** The registry npm would contact for this package. */
  async registryFor(packageName: string, cwd: string): Promise<string> {
    const config = await this.read(cwd);
    const scope = npmScopeOf(packageName);
    return (scope && config.scopedRegistries.get(scope)) || config.registry;
  }
}

/** Whether a registry URL points to a public npm registry. */
export function isPublicNpmRegistry(url: string): boolean {
  try {
    return PUBLIC_NPM_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Extracts registry settings from the JSON printed by `npm config list --json`. */
export function parseNpmConfig(json: Record<string, unknown>): NpmRegistryConfig {
  const scopedRegistries = new Map<string, string>();
  for (const [key, value] of Object.entries(json)) {
    const match = key.match(/^(@[^:]+):registry$/);
    if (match && typeof value === 'string' && value) scopedRegistries.set(match[1]!, value);
  }
  const registry = typeof json.registry === 'string' && json.registry ? json.registry : DEFAULT_REGISTRY;
  return { registry, scopedRegistries };
}

async function loadConfig(cwd: string): Promise<NpmRegistryConfig> {
  try {
    const result = await runCommand('npm', ['config', 'list', '--json'], { cwd, timeoutMs: 15_000 });
    if (result.exitCode !== 0) return parseNpmConfig({});
    return parseNpmConfig(JSON.parse(result.stdout) as Record<string, unknown>);
  } catch {
    // Without a readable configuration npm falls back to the public registry,
    // and so do we — which keeps internal packages from being looked up.
    return parseNpmConfig({});
  }
}
