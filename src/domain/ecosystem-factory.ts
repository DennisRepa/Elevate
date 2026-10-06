/**
 * 🪶 Elevate — Ecosystem Factory (Factory Pattern)
 *
 * Creates and caches the ecosystem strategies for Node/npm and Java/Maven.
 */

import type { Ecosystem } from './models.js';
import type { EcosystemStrategy } from './ecosystem-strategy.js';
import { NpmEcosystemStrategy } from '../adapters/npm/npm-strategy.js';
import { MavenEcosystemStrategy } from '../adapters/maven/maven-strategy.js';
import type { MavenPluginVersions } from '../adapters/maven/maven-resolution.js';

/** Settings the strategies are created with. */
export interface EcosystemSettings {
  /** Versions of the Maven plugins Elevate runs; defaults apply when omitted. */
  mavenPlugins?: MavenPluginVersions;
}

export class EcosystemFactory {
  private static instances = new Map<Ecosystem, EcosystemStrategy>();
  private static settings: EcosystemSettings = {};

  /**
   * Stores the settings and drops the cached strategies, so strategies created
   * afterwards use them. Without a call the defaults apply.
   */
  static configure(settings: EcosystemSettings): void {
    this.settings = settings;
    this.instances.clear();
  }

  /** Returns the strategy for an ecosystem (lazily created singleton). */
  static getStrategy(ecosystem: Ecosystem): EcosystemStrategy {
    let strategy = this.instances.get(ecosystem);
    if (!strategy) {
      if (ecosystem === 'maven') {
        strategy = new MavenEcosystemStrategy(this.settings.mavenPlugins);
      } else {
        strategy = new NpmEcosystemStrategy();
      }
      this.instances.set(ecosystem, strategy);
    }
    return strategy;
  }

  /** All supported ecosystems. */
  static getAvailableEcosystems(): Ecosystem[] {
    return ['npm', 'maven'];
  }
}
