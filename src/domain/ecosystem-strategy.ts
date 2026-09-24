/**
 * 🪶 Elevate — Ecosystem Strategy Interface (Strategy Pattern)
 *
 * Kapselt das gesamte plattformspezifische Verhalten eines
 * Ökosystems (npm vs. Maven) hinter einer einheitlichen Strategie.
 */

import type { Ecosystem, ProjectModule } from './models.js';
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
  /** Ökosystem-Kennung */
  readonly ecosystem: Ecosystem;
  /** Anzeigename */
  readonly displayName: string;
  /** Icon / Emoji */
  readonly icon: string;
  /** Dateiname des Modul-Manifests (z. B. package.json, pom.xml) */
  readonly manifestFile: string;

  /** Ports */
  readonly discovery: ModuleDiscoveryPort;
  readonly registry: RegistryPort;
  readonly reader: DependencyReaderPort;
  readonly updater: DependencyUpdaterPort;
  readonly verifier: VerificationPort;

  /** Liefert die für das Ökosystem passenden Tab-Labels */
  getTabLabels(
    counts: { total: number; prodCount: number; devCount: number },
    t: any,
  ): TabLabels;
}
