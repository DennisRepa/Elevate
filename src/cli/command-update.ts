/**
 * 🪶 Elevate — CLI Command: `update`
 *
 * Applies dependency updates to a target module with safety guardrails:
 * - Major updates require `--allow-major`
 * - Dry-run simulation via `--dry-run`
 * - Automatic post-update verification via build/test
 */

import semver from 'semver';
import type { CliOptions } from './parser.js';
import type { ElevateConfig } from '../config.js';
import type { UpdateCandidate, VersionDiff } from '../domain/models.js';
import { EcosystemFactory } from '../domain/ecosystem-factory.js';

export async function handleUpdateCommand(options: CliOptions, config: ElevateConfig): Promise<number> {
  const ecosystem = options.ecosystem ?? 'npm';
  const strategy = EcosystemFactory.getStrategy(ecosystem);

  const modules = await strategy.discovery.discover(config.rootDir);
  if (modules.length === 0) {
    console.error(`❌ No ${strategy.displayName} modules found.`);
    return 1;
  }

  // Resolve target module
  let targetModule = modules[0]!;
  if (options.module) {
    const match = modules.find(
      (m) =>
        m.id.toLowerCase() === options.module!.toLowerCase() ||
        m.relPath.toLowerCase() === options.module!.toLowerCase() ||
        m.path.toLowerCase().endsWith(options.module!.toLowerCase()),
    );
    if (!match) {
      console.error(`❌ Module '${options.module}' not found.`);
      return 1;
    }
    targetModule = match;
  }

  // Internal module IDs
  const internalIds = new Set<string>();
  for (const m of modules) {
    if (m.id) internalIds.add(m.id);
    if (m.name) internalIds.add(m.name);
  }

  // Scan current candidates
  const availableUpdates = await strategy.reader.scan(
    targetModule,
    config.excludeScopes,
    internalIds,
    options.channel ?? 'stable',
  );

  const updatesToApply: UpdateCandidate[] = [];

  if (options.all) {
    for (const c of availableUpdates) {
      if (c.diff === 'major' && !options.allowMajor) {
        if (!options.json) {
          console.warn(`⚠️  Skipping major update for '${c.coordinate.identifier}' (requires --allow-major)`);
        }
        continue;
      }
      updatesToApply.push(c);
    }
  } else if (options.packages && options.packages.length > 0) {
    for (const item of options.packages) {
      let [name, targetVer] = item.split('@');
      if (item.startsWith('@') && item.includes('@', 1)) {
        // e.g. @my-org/package@1.2.3
        const atIdx = item.lastIndexOf('@');
        name = item.slice(0, atIdx);
        targetVer = item.slice(atIdx + 1);
      }

      const found = availableUpdates.find((u) => u.coordinate.identifier === name);
      if (found) {
        if (targetVer) {
          const prefix = found.currentRange.startsWith('~') ? '~' : found.currentRange.startsWith('^') ? '^' : '';
          const diff: VersionDiff = semver.valid(targetVer) && found.currentClean
            ? (semver.diff(found.currentClean, targetVer) as VersionDiff) || 'minor'
            : 'minor';

          if (diff === 'major' && !options.allowMajor) {
            console.error(`❌ Error: '${name}' requires a major version upgrade to ${targetVer}. Please pass --allow-major.`);
            return 1;
          }

          updatesToApply.push({
            ...found,
            newRange: `${prefix}${targetVer}`,
            diff,
            selected: true,
          });
        } else {
          if (found.diff === 'major' && !options.allowMajor) {
            console.error(`❌ Error: '${name}' is a major update (${found.currentClean} ➔ ${found.latest}). Please pass --allow-major.`);
            return 1;
          }
          updatesToApply.push({ ...found, selected: true });
        }
      } else {
        // Manual override for specific package
        if (!targetVer) {
          console.error(`❌ Package '${name}' has no pending updates detected. Please specify a target version (e.g. ${name}@1.2.3).`);
          return 1;
        }
        updatesToApply.push({
          coordinate: {
            identifier: name!,
            artifact: name!,
            ecosystem,
          },
          currentRange: 'unknown',
          currentClean: '0.0.0',
          latest: targetVer,
          newRange: targetVer,
          diff: 'minor',
          scope: 'prod',
          selected: true,
        });
      }
    }
  } else {
    console.error('❌ Please specify packages to update via --packages="pkg1,pkg2" or --all.');
    return 1;
  }

  if (updatesToApply.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ message: 'No updates selected to apply.', updatedCount: 0 }, null, 2));
    } else {
      console.log('ℹ️  No updates selected to apply.');
    }
    return 0;
  }

  // DRY-RUN Simulation
  if (options.dryRun) {
    const simulationResult = {
      dryRun: true,
      targetModule: targetModule.relPath,
      ecosystem,
      updatesCount: updatesToApply.length,
      updates: updatesToApply.map((u) => ({
        identifier: u.coordinate.identifier,
        currentRange: u.currentRange,
        newRange: u.newRange,
        diff: u.diff,
      })),
    };

    if (options.json) {
      console.log(JSON.stringify(simulationResult, null, 2));
    } else {
      console.log(`\n🪶 [DRY-RUN] Planned updates for ${targetModule.name} (${updatesToApply.length}):\n`);
      for (const u of updatesToApply) {
        console.log(`  • ${u.coordinate.identifier.padEnd(36)} ${u.currentRange} ➔ ${u.newRange} (${u.diff.toUpperCase()})`);
      }
      console.log('\n(No files were modified because --dry-run is active).\n');
    }
    return 0;
  }

  // EXECUTE ACTUAL UPDATE
  if (!options.json) {
    console.log(`\n⚡ Applying ${updatesToApply.length} update(s) to ${targetModule.name}…`);
  }

  const updateResult = await strategy.updater.applyUpdates(
    targetModule,
    config.rootDir,
    updatesToApply,
    (step) => {
      if (!options.json) console.log(`   ${step}`);
    },
  );

  // AUTOMATIC VERIFICATION (BUILD / TEST)
  let verifyResult: { status: 'clean' | 'warn'; details: string; label: string } | undefined;
  if (!options.skipVerify) {
    if (!options.json) console.log(`🔍 Running build & test verification…`);
    verifyResult = await strategy.verifier.verify(
      targetModule,
      config.rootDir,
      config.postUpdateScript,
      config.postUpdateLabel,
    );
  }

  const finalSummary = {
    success: verifyResult?.status !== 'warn',
    module: targetModule.relPath,
    ecosystem,
    ...updateResult,
    verification: verifyResult
      ? {
          status: verifyResult.status,
          label: verifyResult.label,
          details: verifyResult.details,
        }
      : undefined,
  };

  if (options.json) {
    console.log(JSON.stringify(finalSummary, null, 2));
    return finalSummary.success ? 0 : 2;
  }

  console.log(`\n✨ Update completed successfully!\n`);
  console.log(`  • Updated: ${updateResult.updatedCount} package(s)`);
  console.log(`  • Audit Status: ${updateResult.auditSeverity.toUpperCase()} — ${updateResult.auditMessage}`);
  if (verifyResult) {
    console.log(`  • Verification: ${verifyResult.status.toUpperCase()} (${verifyResult.label})`);
    if (verifyResult.status === 'warn') {
      console.warn(`    Details: ${verifyResult.details}`);
    }
  }
  console.log('');

  return finalSummary.success ? 0 : 2;
}
