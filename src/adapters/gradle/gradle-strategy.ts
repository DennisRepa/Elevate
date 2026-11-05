/**
 * Elevate — Gradle ecosystem strategy: wires the Gradle adapters together.
 */

import type { EcosystemStrategy, TabLabels } from '../../domain/ecosystem-strategy.js';
import type { Ecosystem } from '../../domain/models.js';
import { mavenVersionPolicy } from '../../domain/version-policy.js';
import { GradleModuleDiscoveryAdapter } from './gradle-discovery.js';
import { GradleRegistryAdapter } from './gradle-registry.js';
import { GradleDependencyAdapter } from './gradle-scanner.js';
import { GradleUpdaterAdapter } from './gradle-updater.js';
import { GradleVerificationAdapter } from './gradle-verifier.js';

export class GradleEcosystemStrategy implements EcosystemStrategy {
  readonly ecosystem: Ecosystem = 'gradle';
  readonly displayName = 'Java / Gradle';
  readonly icon = '🐘';
  readonly manifestFile = 'build.gradle';
  /** Gradle versions follow the JVM rules Maven uses: a version is written as it is, `1.0-rc1` is a pre-release. */
  readonly versioning = mavenVersionPolicy;

  readonly discovery = new GradleModuleDiscoveryAdapter();
  readonly registry = new GradleRegistryAdapter();
  readonly reader = new GradleDependencyAdapter();
  readonly updater = new GradleUpdaterAdapter();
  readonly verifier = new GradleVerificationAdapter();

  getTabLabels(
    counts: { total: number; prodCount: number; devCount: number },
    t: any,
  ): TabLabels {
    return {
      all: t.tabs.all(counts.total),
      prod: t.tabs.main(counts.prodCount),
      dev: t.tabs.testAndPlugins(counts.devCount),
    };
  }
}
