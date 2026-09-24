import type { EcosystemStrategy, TabLabels } from '../../domain/ecosystem-strategy.js';
import type { Ecosystem } from '../../domain/models.js';
import { NpmModuleDiscoveryAdapter } from './npm-discovery.js';
import { NpmRegistryAdapter } from './npm-registry.js';
import { NpmDependencyAdapter } from './npm-scanner.js';
import { NpmUpdaterAdapter } from './npm-updater.js';
import { NpmVerificationAdapter } from './npm-verifier.js';

export class NpmEcosystemStrategy implements EcosystemStrategy {
  readonly ecosystem: Ecosystem = 'npm';
  readonly displayName = 'Node / npm';
  readonly icon = '📦';
  readonly manifestFile = 'package.json';

  readonly discovery = new NpmModuleDiscoveryAdapter();
  readonly registry = new NpmRegistryAdapter();
  readonly reader = new NpmDependencyAdapter(this.registry);
  readonly updater = new NpmUpdaterAdapter();
  readonly verifier = new NpmVerificationAdapter();

  getTabLabels(
    counts: { total: number; prodCount: number; devCount: number },
    t: any,
  ): TabLabels {
    return {
      all: t.tabs.all(counts.total),
      prod: t.tabs.dependencies(counts.prodCount),
      dev: t.tabs.devDependencies(counts.devCount),
    };
  }
}
