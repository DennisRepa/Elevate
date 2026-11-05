/**
 * 🪶 Elevate — CLI Command: `modules`
 *
 * Lists all discovered modules in the monorepo for the specified ecosystem.
 */

import type { CliOptions } from './parser.js';
import type { ElevateConfig } from '../config.js';
import { discoverModules } from '../application/scan.js';
import { EcosystemFactory } from '../domain/ecosystem-factory.js';

export async function handleModulesCommand(options: CliOptions, config: ElevateConfig): Promise<number> {
  const ecosystem = options.ecosystem ?? 'npm';
  const strategy = EcosystemFactory.getStrategy(ecosystem);

  const { modules, diagnostics } = await discoverModules(strategy, config.rootDir);
  const displayName = strategy.displayNameFor?.(config.rootDir) ?? strategy.displayName;
  const packageManager = strategy.packageManagerFor?.(config.rootDir);

  if (options.json) {
    console.log(JSON.stringify({ ecosystem, ...(packageManager ? { packageManager } : {}), count: modules.length, modules, diagnostics }, null, 2));
    return 0;
  }

  console.log(`\n🪶 Discovered ${strategy.icon} ${displayName} Modules (${modules.length}):\n`);
  for (const m of modules) {
    const isRootBadge = m.isRoot ? ' [ROOT]' : '';
    console.log(`  • ${m.name.padEnd(45)} (${m.relPath})${isRootBadge}`);
  }
  console.log('');
  for (const problem of diagnostics) console.error(`⚠️  ${problem}`);
  return 0;
}
