/**
 * Elevate — CLI command: `scan`
 *
 * Scans dependencies of one or all modules for available updates and
 * internal dependencies that need alignment.
 *
 * Exit codes: 0 = up to date, 1 = updates available, 3 = scan error.
 */

import type { CliOptions } from './parser.js';
import type { ElevateConfig } from '../config.js';
import type { ProjectModule, ScanResult } from '../domain/models.js';
import { EcosystemFactory } from '../domain/ecosystem-factory.js';
import { candidateToJson, createScanContext, findModule, scanModules } from '../application/scan.js';
import { describeSkip } from '../application/describe.js';

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

  const targetModules: ProjectModule[] = [];
  if (options.allModules) {
    targetModules.push(...modules);
  } else if (options.module) {
    const match = findModule(modules, options.module);
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
    targetModules.push(modules[0]!);
  }

  const context = createScanContext(modules, config, channel);
  if (!options.json) process.stderr.write(`🔍 Scanning ${targetModules.map((m) => m.relPath).join(', ')}…\n`);
  const scanned = await scanModules(strategy, targetModules, context);
  const results: { module: ProjectModule; result: ScanResult & { error?: string } }[] = targetModules.map(
    (module) => ({ module, result: scanned.get(module)! }),
  );

  const totalUpdatesCount = results.reduce((sum, r) => sum + r.result.candidates.length, 0);
  const hasErrors = results.some((r) => r.result.error);
  const exitCode = hasErrors ? 3 : totalUpdatesCount > 0 ? 1 : 0;

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          ecosystem,
          channel,
          scannedModules: targetModules.length,
          totalUpdatesCount,
          results: results.map(({ module, result }) => ({
            moduleId: module.id,
            modulePath: module.relPath,
            updateCount: result.candidates.length,
            error: result.error,
            updates: result.candidates.map(candidateToJson),
            skipped: result.skipped,
          })),
        },
        null,
        2,
      ),
    );
    return exitCode;
  }

  console.log(`\n🪶 Elevate Scan Results (${strategy.icon} ${strategy.displayName}, Channel: ${channel}):\n`);

  for (const { module, result } of results) {
    console.log(`📦 Module: ${module.name} (${module.relPath}) — ${result.candidates.length} update(s) available`);
    if (result.error) {
      console.log(`   ❌ Scan failed: ${result.error.replace(/\n/g, '\n      ')}\n`);
      continue;
    }

    const modulePom = module.isRoot ? 'pom.xml' : `${module.relPath}/pom.xml`;
    if (result.candidates.length === 0) console.log('   ✨ All dependencies are up to date.');
    for (const u of result.candidates) {
      const diffTag = `[${u.diff.toUpperCase()}]`.padEnd(9);
      const actionTag = u.action === 'align' ? '[ALIGN] ' : u.origin.kind === 'private' ? '[INTERNAL] ' : '';
      const preBadge = u.isPreRelease ? `[${u.preReleaseTag || 'PRE'}] ` : '';
      const where = u.declaration && u.declaration.displayPath !== modulePom
        ? `  (in ${u.declaration.displayPath}${u.declaration.propertyName ? ` \${${u.declaration.propertyName}}` : ''})`
        : '';
      console.log(
        `   • ${diffTag} ${actionTag}${preBadge}${u.coordinate.identifier.padEnd(36)} ${u.currentRange.padEnd(12)} ➔ ${u.latest}${where}`,
      );
    }

    for (const s of result.skipped) {
      console.log(`   ⚠️  ${s.identifier}: ${describeSkip(s)}`);
    }
    console.log('');
  }

  console.log(`Summary: ${totalUpdatesCount} pending update(s) across ${targetModules.length} module(s).\n`);
  return exitCode;
}
