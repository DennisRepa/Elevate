/**
 * 🪶 Elevate — CLI Command: `modules`
 *
 * Lists all discovered modules in the monorepo for the specified ecosystem.
 */

import type { CliOptions } from './parser.js';
import type { ElevateConfig } from '../config.js';
import { EcosystemFactory } from '../domain/ecosystem-factory.js';

export async function handleModulesCommand(options: CliOptions, config: ElevateConfig): Promise<number> {
  const ecosystem = options.ecosystem ?? 'npm';
  const strategy = EcosystemFactory.getStrategy(ecosystem);

  const modules = await strategy.discovery.discover(config.rootDir);

  if (options.json) {
    console.log(JSON.stringify({ ecosystem, count: modules.length, modules }, null, 2));
    return 0;
  }

  console.log(`\n🪶 Discovered ${strategy.icon} ${strategy.displayName} Modules (${modules.length}):\n`);
  for (const m of modules) {
    const isRootBadge = m.isRoot ? ' [ROOT]' : '';
    console.log(`  • ${m.name.padEnd(45)} (${m.relPath})${isRootBadge}`);
  }
  console.log('');
  return 0;
}
