/**
 * 🪶 Elevate — Ecosystem Factory (Factory Pattern)
 *
 * Verwaltet und instanziiert die passenden Ökosystem-Strategien
 * für Node/npm und Java/Maven.
 */

import type { Ecosystem } from './models.js';
import type { EcosystemStrategy } from './ecosystem-strategy.js';
import { NpmEcosystemStrategy } from '../adapters/npm/npm-strategy.js';
import { MavenEcosystemStrategy } from '../adapters/maven/maven-strategy.js';

export class EcosystemFactory {
  private static instances = new Map<Ecosystem, EcosystemStrategy>();

  /** Liefert die Strategie für das gewünschte Ökosystem (Lazy Singleton) */
  static getStrategy(ecosystem: Ecosystem): EcosystemStrategy {
    let strategy = this.instances.get(ecosystem);
    if (!strategy) {
      if (ecosystem === 'maven') {
        strategy = new MavenEcosystemStrategy();
      } else {
        strategy = new NpmEcosystemStrategy();
      }
      this.instances.set(ecosystem, strategy);
    }
    return strategy;
  }

  /** Liefert alle verfügbaren Ökosysteme */
  static getAvailableEcosystems(): Ecosystem[] {
    return ['npm', 'maven'];
  }
}
