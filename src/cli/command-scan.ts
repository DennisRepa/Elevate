/**
 * 🪶 Elevate — CLI Command: `scan`
 *
 * Scans dependencies of one or all modules for available registry updates.
 */

import type { CliOptions } from './parser.js';
import type { ElevateConfig } from '../config.js';
import type { ProjectModule, UpdateCandidate } from '../domain/models.js';
import { EcosystemFactory } from '../domain/ecosystem-factory.js';

export async function handleScanCommand(options: CliOptions, config: ElevateConfig): Promise<number> {
  const ecosystem = options.ecosystem ?? 'npm';
  const channel = options.channel ?? config.channel ?? 'stable';
  const strategy = EcosystemFactory.getStrategy(ecosystem);

  const modules = await strategy.discovery.discover(config.rootDir);
  if (modules.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ error: `No ${strategy.displayName} modules found.`, ecosystem }, null, 2));
    } else {
      console.error(`❌ No ${strategy.displayName} modules found.`);
    }
    return 1;
  }

  // Collect internal IDs to protect internal monorepo packages
  const internalIds = new Set<string>();
  for (const m of modules) {
    if (m.id) internalIds.add(m.id);
    if (m.name) internalIds.add(m.name);
  }

  const targetModules: ProjectModule[] = [];

  if (options.allModules) {
    targetModules.push(...modules);
  } else if (options.module) {
    const match = modules.find(
      (m) =>
        m.id.toLowerCase() === options.module!.toLowerCase() ||
        m.relPath.toLowerCase() === options.module!.toLowerCase() ||
        m.path.toLowerCase().endsWith(options.module!.toLowerCase()),
    );
    if (!match) {
      if (options.json) {
        console.log(
          JSON.stringify(
            { error: `Module '${options.module}' not found.`, available: modules.map((m) => m.relPath) },
            null,
            2,
          ),
        );
      } else {
        console.error(`❌ Module '${options.module}' not found.`);
      }
      return 1;
    }
    targetModules.push(match);
  } else {
    // Default: Root or first module
    targetModules.push(modules[0]!);
  }

  const allResults: { module: ProjectModule; updates: UpdateCandidate[] }[] = [];
  let totalUpdatesCount = 0;

  for (const mod of targetModules) {
    try {
      const updates = await strategy.reader.scan(mod, config.excludeScopes, internalIds, channel);
      allResults.push({ module: mod, updates });
      totalUpdatesCount += updates.length;
    } catch {
      allResults.push({ module: mod, updates: [] });
    }
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          ecosystem,
          channel,
          scannedModules: targetModules.length,
          totalUpdatesCount,
          results: allResults.map((r) => ({
            moduleId: r.module.id,
            modulePath: r.module.relPath,
            updateCount: r.updates.length,
            updates: r.updates.map((u) => ({
              identifier: u.coordinate.identifier,
              currentRange: u.currentRange,
              currentClean: u.currentClean,
              latest: u.latest,
              newRange: u.newRange,
              diff: u.diff,
              scope: u.scope,
              isPreRelease: u.isPreRelease ?? false,
              preReleaseTag: u.preReleaseTag,
            })),
          })),
        },
        null,
        2,
      ),
    );
    return totalUpdatesCount > 0 ? 1 : 0;
  }

  console.log(`\n🪶 Elevate Scan Results (${strategy.icon} ${strategy.displayName}, Channel: ${channel}):\n`);

  for (const r of allResults) {
    console.log(`📦 Module: ${r.module.name} (${r.module.relPath}) — ${r.updates.length} update(s) available`);
    if (r.updates.length === 0) {
      console.log('   ✨ All dependencies are up to date.\n');
      continue;
    }

    for (const u of r.updates) {
      const diffTag = `[${u.diff.toUpperCase()}]`.padEnd(9);
      const preBadge = u.isPreRelease ? `[${u.preReleaseTag || 'PRE'}] ` : '';
      console.log(
        `   • ${diffTag} ${preBadge}${u.coordinate.identifier.padEnd(36)} ${u.currentRange.padEnd(12)} ➔ ${u.latest}`,
      );
    }
    console.log('');
  }

  console.log(`Summary: ${totalUpdatesCount} pending update(s) across ${targetModules.length} module(s).\n`);
  return totalUpdatesCount > 0 ? 1 : 0;
}
