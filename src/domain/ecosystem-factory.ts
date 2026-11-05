/**
 * 🪶 Elevate — Ecosystem Factory (Factory Pattern)
 *
 * Creates and caches the ecosystem strategies for Node/npm, Java/Maven, Rust/Cargo and Java/Gradle.
 */

import type { Ecosystem } from './models.js';
import type { EcosystemStrategy } from './ecosystem-strategy.js';
import { NpmEcosystemStrategy } from '../adapters/npm/npm-strategy.js';
import { CargoEcosystemStrategy } from '../adapters/cargo/cargo-strategy.js';
import { MavenEcosystemStrategy } from '../adapters/maven/maven-strategy.js';
import { GradleEcosystemStrategy } from '../adapters/gradle/gradle-strategy.js';
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
      } else if (ecosystem === 'cargo') {
        strategy = new CargoEcosystemStrategy();
      } else if (ecosystem === 'gradle') {
        strategy = new GradleEcosystemStrategy();
      } else {
        strategy = new NpmEcosystemStrategy();
      }
      this.instances.set(ecosystem, strategy);
    }
    return strategy;
  }

  /**
   * All supported ecosystems. The order is the order the repository root is
   * asked in and the order the dashboard cycles through.
   */
  static getAvailableEcosystems(): Ecosystem[] {
    return ['npm', 'maven', 'cargo', 'gradle'];
  }

  /** The ecosystem after `current`, for the dashboard's ecosystem switch. */
  static next(current: Ecosystem): Ecosystem {
    const all = this.getAvailableEcosystems();
    return all[(all.indexOf(current) + 1) % all.length]!;
  }
}
