/**
 * Elevate — Maven ecosystem strategy: wires the Maven adapters together.
 */

import type { EcosystemStrategy, TabLabels } from '../../domain/ecosystem-strategy.js';
import type { Ecosystem } from '../../domain/models.js';
import { MavenModuleDiscoveryAdapter } from './maven-discovery.js';
import { MavenRegistryAdapter } from './maven-registry.js';
import { MavenDependencyAdapter } from './maven-scanner.js';
import { MavenUpdaterAdapter } from './maven-updater.js';
import { MavenVerificationAdapter } from './maven-verifier.js';
import { DEFAULT_MAVEN_PLUGINS } from './maven-resolution.js';
import type { MavenPluginVersions } from './maven-resolution.js';

export class MavenEcosystemStrategy implements EcosystemStrategy {
  readonly ecosystem: Ecosystem = 'maven';
  readonly displayName = 'Java / Maven';
  readonly icon = '☕';
  readonly manifestFile = 'pom.xml';

  readonly discovery = new MavenModuleDiscoveryAdapter();
  readonly registry: MavenRegistryAdapter;
  readonly reader: MavenDependencyAdapter;
  readonly updater = new MavenUpdaterAdapter();
  readonly verifier = new MavenVerificationAdapter();

  /** @param plugins versions of the Maven plugins Elevate runs (default: the pinned ones) */
  constructor(plugins: MavenPluginVersions = DEFAULT_MAVEN_PLUGINS) {
    this.registry = new MavenRegistryAdapter(plugins);
    this.reader = new MavenDependencyAdapter(plugins);
  }

  getTabLabels(
    counts: { total: number; prodCount: number; devCount: number },
    _t: any,
  ): TabLabels {
    return {
      all: `[1] Alle (${counts.total})`,
      prod: `[2] Compile (${counts.prodCount})`,
      dev: `[3] Test (${counts.devCount})`,
    };
  }
}
