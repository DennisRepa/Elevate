/**
 * Elevate — `cargo metadata --no-deps`.
 *
 * Works without network access and without a Cargo.lock, resolves
 * `workspace = true` inheritance, and reports each dependency with its
 * normalised requirement, kind, target and source.
 */

import { runCargo, cargoErrors } from './cargo-command.js';

export interface MetadataDependency {
  name: string;
  req: string;
  kind: 'dev' | 'build' | null;
  rename: string | null;
  /** `registry+…crates.io-index`, `sparse+<url>`, `git+…`; null for path dependencies. */
  source: string | null;
  /** Index URL of an alternative registry. */
  registry?: string | null;
  path?: string;
  target: string | null;
  optional: boolean;
}

export interface MetadataPackage {
  name: string;
  version: string;
  manifest_path: string;
  rust_version: string | null;
  dependencies: MetadataDependency[];
}

export interface CargoMetadata {
  packages: MetadataPackage[];
  workspace_root: string;
}

export class CargoMetadataError extends Error {
  constructor(message: string, readonly dir: string) {
    super(message);
    this.name = 'CargoMetadataError';
  }
}

export async function loadMetadata(dir: string): Promise<CargoMetadata> {
  const result = await runCargo(['metadata', '--no-deps', '--format-version', '1'], { cwd: dir, timeoutMs: 60_000 });
  if (result.exitCode !== 0) {
    throw new CargoMetadataError(`cargo metadata failed in ${dir}: ${cargoErrors(result.stderr || result.stdout)}`, dir);
  }
  try {
    return JSON.parse(result.stdout) as CargoMetadata;
  } catch {
    throw new CargoMetadataError(`cargo metadata printed no JSON in ${dir}.`, dir);
  }
}
