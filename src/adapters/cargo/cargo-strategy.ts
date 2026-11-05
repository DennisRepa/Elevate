/**
 * Elevate — Cargo ecosystem strategy: wires the Cargo adapters together.
 */

import semver from 'semver';
import type { EcosystemStrategy, TabLabels } from '../../domain/ecosystem-strategy.js';
import type { Ecosystem } from '../../domain/models.js';
import type { VersionPolicy } from '../../domain/version-policy.js';
import { CargoModuleDiscoveryAdapter } from './cargo-discovery.js';
import { CargoConfigReader } from './cargo-config.js';
import { CargoIndexClient } from './cargo-index.js';
import { loadMetadata } from './cargo-metadata.js';
import { CargoRegistryAdapter } from './cargo-registry.js';
import { cargoDiff, rewriteRequirement } from './cargo-requirement.js';
import { CargoDependencyAdapter } from './cargo-scanner.js';
import { CargoUpdaterAdapter } from './cargo-updater.js';
import { CargoVerificationAdapter } from './cargo-verifier.js';

export const cargoVersionPolicy: VersionPolicy = {
  normalize: (v) => semver.valid(v),
  rewrite: rewriteRequirement,
  diff: (current, target) => (semver.valid(current) && semver.valid(target) ? (semver.eq(current, target) ? 'patch' : cargoDiff(current, target)) : 'minor'),
  // Updates are written where the scan found the declaration.
  allowsManualTargets: false,
};

export class CargoEcosystemStrategy implements EcosystemStrategy {
  readonly ecosystem: Ecosystem = 'cargo';
  readonly displayName = 'Rust / Cargo';
  readonly icon = '🦀';
  readonly manifestFile = 'Cargo.toml';
  readonly versioning = cargoVersionPolicy;

  private readonly config = new CargoConfigReader();
  private readonly index = new CargoIndexClient();
  private readonly endpoint = (registry: string | undefined, cwd: string) => this.config.resolve(registry, cwd);

  readonly discovery = new CargoModuleDiscoveryAdapter();
  readonly registry = new CargoRegistryAdapter({ index: this.index, endpoint: this.endpoint });
  readonly reader = new CargoDependencyAdapter({ loadMetadata, index: this.index, endpoint: this.endpoint });
  readonly updater = new CargoUpdaterAdapter();
  readonly verifier = new CargoVerificationAdapter();

  getTabLabels(counts: { total: number; prodCount: number; devCount: number }, t: any): TabLabels {
    return {
      all: t.tabs.all(counts.total),
      prod: t.tabs.dependencies(counts.prodCount),
      dev: t.tabs.devDependencies(counts.devCount),
    };
  }
}
