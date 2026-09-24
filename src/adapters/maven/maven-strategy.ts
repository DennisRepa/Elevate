import type { EcosystemStrategy, TabLabels } from '../../domain/ecosystem-strategy.js';
import type { Ecosystem } from '../../domain/models.js';
import { MavenModuleDiscoveryAdapter } from './maven-discovery.js';
import { MavenRegistryAdapter } from './maven-registry.js';
import { MavenDependencyAdapter } from './maven-scanner.js';
import { MavenUpdaterAdapter } from './maven-updater.js';
import { MavenVerificationAdapter } from './maven-verifier.js';

export class MavenEcosystemStrategy implements EcosystemStrategy {
  readonly ecosystem: Ecosystem = 'maven';
  readonly displayName = 'Java / Maven';
  readonly icon = '☕';
  readonly manifestFile = 'pom.xml';

  readonly discovery = new MavenModuleDiscoveryAdapter();
  readonly registry = new MavenRegistryAdapter();
  readonly reader = new MavenDependencyAdapter(this.registry);
  readonly updater = new MavenUpdaterAdapter();
  readonly verifier = new MavenVerificationAdapter();

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
