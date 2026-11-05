/**
 * 🪶 Elevate — Ecosystem Strategy Interface (Strategy Pattern)
 *
 * Encapsulates all ecosystem-specific behaviour (npm vs. Maven) behind
 * one common strategy.
 */

import type { Ecosystem, ProjectModule } from './models.js';
import type { VersionPolicy } from './version-policy.js';
import type {
  ModuleDiscoveryPort,
  RegistryPort,
  DependencyReaderPort,
  DependencyUpdaterPort,
  VerificationPort,
} from './ports.js';

export interface TabLabels {
  all: string;
  prod: string;
  dev: string;
}

export interface EcosystemStrategy {
  /** Ecosystem identifier. */
  readonly ecosystem: Ecosystem;
  /** Display name. */
  readonly displayName: string;
  /** Display name for a repository, when it depends on the package manager in use. */
  displayNameFor?(rootDir: string): string;
  /** The package manager driving the repository (Node.js ecosystem only). */
  packageManagerFor?(rootDir: string): string;
  /** Icon / emoji. */
  readonly icon: string;
  /** File name of the module manifest (e.g. package.json, pom.xml). */
  readonly manifestFile: string;

  /** Version rules of this ecosystem. */
  readonly versioning: VersionPolicy;

  /** Ports */
  readonly discovery: ModuleDiscoveryPort;
  readonly registry: RegistryPort;
  readonly reader: DependencyReaderPort;
  readonly updater: DependencyUpdaterPort;
  readonly verifier: VerificationPort;

  /** Tab labels for this ecosystem. */
  getTabLabels(
    counts: { total: number; prodCount: number; devCount: number },
    t: any,
  ): TabLabels;
}
