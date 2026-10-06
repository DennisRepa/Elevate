/**
 * Elevate — CLI command: `update`
 *
 * Applies dependency updates to a target module with safety guardrails:
 * - major updates require `--allow-major`
 * - `--dry-run` simulates without touching files
 * - after writing, the update is installed, checked for integrity and
 *   verified; any failure rolls all changes back (`--keep-on-failure` keeps
 *   the changes of a failed verification for investigation)
 *
 * Exit codes: 0 = success, 1 = invalid request, 2 = update failed / rolled back.
 */

import type { CliOptions } from './parser.js';
import type { ElevateConfig } from '../config.js';
import type { UpdateCandidate } from '../domain/models.js';
import { EcosystemFactory } from '../domain/ecosystem-factory.js';
import { classifyOrigin } from '../domain/origin.js';
import { createScanContext, findModule, scanModule } from '../application/scan.js';
import { UpdateSelectionError, selectAll, selectRequested } from '../application/update-selection.js';
import type { UpdateRequest } from '../application/update-selection.js';
import { runUpdateWorkflow } from '../application/update-workflow.js';

export async function handleUpdateCommand(options: CliOptions, config: ElevateConfig): Promise<number> {
  const ecosystem = options.ecosystem ?? 'npm';
  const strategy = EcosystemFactory.getStrategy(ecosystem);
  const fail = (message: string, code = 1) => {
    if (options.json) console.log(JSON.stringify({ success: false, error: message }, null, 2));
    else console.error(`❌ ${message}`);
    return code;
  };

  const modules = await strategy.discovery.discover(config.rootDir);
  if (modules.length === 0) return fail(`No ${strategy.displayName} modules found.`);

  const targetModule = options.module ? findModule(modules, options.module) : modules[0];
  if (!targetModule) return fail(`Module '${options.module}' not found.`);

  if (!options.all && !(options.packages && options.packages.length > 0)) {
    return fail('Please specify packages to update via --packages="pkg1,pkg2@1.2.3" or --all.');
  }

  const context = createScanContext(modules, config, options.channel ?? config.channel ?? 'stable');
  const scan = await scanModule(strategy, targetModule, context);
  if (scan.error) return fail(`Scan failed: ${scan.error}`, 2);

  let updatesToApply: UpdateCandidate[];
  if (options.all) {
    const { selected, skippedMajors } = selectAll(scan, Boolean(options.allowMajor));
    if (!options.json) {
      for (const c of skippedMajors) {
        console.warn(`⚠️  Skipping major update for '${c.coordinate.identifier}' (requires --allow-major)`);
      }
    }
    updatesToApply = selected;
  } else {
    try {
      updatesToApply = selectRequested(scan, (options.packages ?? []).map(parsePackageArgument), {
        ecosystem,
        allowMajor: Boolean(options.allowMajor),
        originOf: (identifier) => classifyOrigin(identifier, ecosystem, context).kind,
      });
    } catch (err) {
      if (err instanceof UpdateSelectionError) return fail(err.message);
      throw err;
    }
  }

  if (updatesToApply.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ message: 'No updates selected to apply.', updatedCount: 0 }, null, 2));
    } else {
      console.log('ℹ️  No updates selected to apply.');
    }
    return 0;
  }

  if (options.dryRun) {
    const simulation = {
      dryRun: true,
      targetModule: targetModule.relPath,
      ecosystem,
      updatesCount: updatesToApply.length,
      updates: updatesToApply.map((u) => ({
        identifier: u.coordinate.identifier,
        action: u.action,
        currentRange: u.currentRange,
        newRange: u.newRange,
        diff: u.diff,
        declaredIn: u.declaration?.displayPath,
      })),
    };

    if (options.json) {
      console.log(JSON.stringify(simulation, null, 2));
    } else {
      console.log(`\n🪶 [DRY-RUN] Planned updates for ${targetModule.name} (${updatesToApply.length}):\n`);
      for (const u of updatesToApply) {
        const where = u.declaration ? `  [${u.declaration.displayPath}]` : '';
        console.log(
          `  • ${u.coordinate.identifier.padEnd(36)} ${u.currentRange} ➔ ${u.newRange} (${u.diff.toUpperCase()})${where}`,
        );
      }
      console.log('\n(No files were modified because --dry-run is active).\n');
    }
    return 0;
  }

  if (!options.json) console.log(`\n⚡ Applying ${updatesToApply.length} update(s) to ${targetModule.name}…`);

  const summary = await runUpdateWorkflow(strategy, targetModule, config.rootDir, updatesToApply, {
    postUpdateScript: config.postUpdateScript,
    postUpdateLabel: config.postUpdateLabel,
    skipVerification: options.skipVerify,
    keepOnFailure: options.keepOnFailure,
    onProgress: (step) => {
      if (!options.json) console.log(`   ${step}`);
    },
  });

  const success = !summary.rolledBack && summary.verificationStatus !== 'warn';

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          success,
          module: targetModule.relPath,
          ecosystem,
          updatedCount: summary.updatedCount,
          auditMessage: summary.auditMessage,
          auditSeverity: summary.auditSeverity,
          fundingMessage: summary.fundingMessage,
          rolledBack: summary.rolledBack ?? false,
          failure: summary.failure,
          changedFiles: summary.changedFiles,
          verification: summary.verificationStatus
            ? {
                status: summary.verificationStatus,
                label: summary.verificationLabel,
                details: summary.verificationDetails,
              }
            : undefined,
        },
        null,
        2,
      ),
    );
    return success ? 0 : 2;
  }

  if (summary.rolledBack) {
    console.error(`\n❌ Update failed and was rolled back.\n`);
    console.error(`  ${summary.failure?.replace(/\n/g, '\n  ')}`);
    if (summary.verificationDetails) console.error(`\n  Details:\n  ${summary.verificationDetails.replace(/\n/g, '\n  ')}`);
    console.error('');
    return 2;
  }

  console.log(success ? `\n✨ Update completed successfully!\n` : `\n⚠️  Update applied, but verification failed.\n`);
  console.log(`  • Updated: ${summary.updatedCount} package(s)`);
  if (summary.changedFiles?.length) console.log(`  • Changed files: ${summary.changedFiles.join(', ')}`);
  console.log(`  • Status: ${summary.auditSeverity.toUpperCase()} — ${summary.auditMessage}`);
  if (summary.verificationStatus) {
    console.log(`  • Verification: ${summary.verificationStatus.toUpperCase()} (${summary.verificationLabel})`);
    if (summary.verificationStatus === 'warn') console.warn(`    Details: ${summary.verificationDetails}`);
  }
  console.log('');

  return success ? 0 : 2;
}

/** Parses `name`, `name@1.2.3`, `@scope/name@1.2.3` or `group:artifact@1.2.3`. */
export function parsePackageArgument(item: string): UpdateRequest {
  const at = item.lastIndexOf('@');
  if (at > 0) return { identifier: item.slice(0, at), targetVersion: item.slice(at + 1) || undefined };
  return { identifier: item };
}
