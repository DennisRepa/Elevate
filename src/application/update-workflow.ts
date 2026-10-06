/**
 * Elevate — update workflow with rollback.
 *
 *   snapshot → write & install → integrity check → verification
 *
 * If any step fails, every captured file is restored and the installed state
 * is re-synchronised, so a failed update leaves the repository as it was.
 *
 * Verification also runs once before the update. A check that already fails
 * beforehand says nothing about the update, so it does not trigger a rollback;
 * the summary reports it as a pre-existing failure instead.
 * `keepOnFailure` keeps the changes of a failed verification for manual
 * investigation; install and integrity failures are always rolled back,
 * because they leave the dependency tree in a state nobody chose.
 */

import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import type { EcosystemStrategy } from '../domain/ecosystem-strategy.js';
import type { ProjectModule, UpdateCandidate, UpdateSummary } from '../domain/models.js';
import { InstallError } from '../domain/ports.js';
import type { VerificationOptions, VerificationResult } from '../domain/ports.js';
import { FileSnapshot } from '../adapters/shared/file-snapshot.js';

export interface UpdateWorkflowOptions {
  postUpdateScript?: string;
  postUpdateLabel?: string;
  skipVerification?: boolean;
  /** Keep the changes when verification fails (default: roll back). */
  keepOnFailure?: boolean;
  onProgress?: (step: string) => void;
}

export async function runUpdateWorkflow(
  strategy: EcosystemStrategy,
  module: ProjectModule,
  rootDir: string,
  updates: UpdateCandidate[],
  options: UpdateWorkflowOptions = {},
): Promise<UpdateSummary> {
  const progress = options.onProgress ?? (() => {});
  const snapshot = FileSnapshot.capture(strategy.updater.affectedFiles(module, rootDir, updates));

  const rollback = async (failure: string, partial: Partial<UpdateSummary> = {}): Promise<UpdateSummary> => {
    progress('Rolling back all changes…');
    snapshot.restore();
    let resyncFailure = '';
    try {
      await strategy.updater.resync(module, rootDir, progress);
    } catch (err) {
      resyncFailure = `\nRestoring the installed state failed as well: ${message(err)}`;
    }
    return {
      auditMessage: 'Update was rolled back.',
      ...partial,
      auditSeverity: 'warn',
      updatedCount: 0,
      changedFiles: [],
      rolledBack: true,
      failure: failure + resyncFailure,
    };
  };

  const verify = (changedFiles: string[]) =>
    safeVerify(strategy, module, rootDir, {
      customScript: options.postUpdateScript,
      customLabel: options.postUpdateLabel,
      changedFiles,
    });

  let baseline: VerificationResult | undefined;
  if (!options.skipVerification) {
    progress('Running verification on the current state…');
    baseline = await verify(snapshot.files.filter((file) => existsSync(file)));
  }

  let applied;
  try {
    applied = await strategy.updater.applyUpdates(module, rootDir, updates, progress);
  } catch (err) {
    const output = err instanceof InstallError && err.output ? `\n${err.output}` : '';
    return rollback(`${message(err)}${output}`);
  }

  const { integrityViolations, ...outcome } = applied;
  if (integrityViolations.length > 0) {
    return rollback(`Integrity check failed:\n${integrityViolations.map((v) => `• ${v}`).join('\n')}`, outcome);
  }

  const changedFiles = snapshot.changedFiles();
  if (options.skipVerification) {
    return { ...outcome, changedFiles: displayPaths(changedFiles, rootDir) };
  }

  progress('Running verification…');
  const verification = await verify(changedFiles);
  const preExisting = verification.status === 'warn' && baseline?.status === 'warn';

  const summary: UpdateSummary = {
    ...outcome,
    verificationStatus: verification.status,
    verificationDetails: preExisting
      ? `Verification already failed before the update; the update was kept.\n${verification.details}`
      : verification.details,
    verificationLabel: verification.label,
    changedFiles: displayPaths(changedFiles, rootDir),
  };

  if (verification.status === 'warn' && !preExisting && !options.keepOnFailure) {
    return rollback(`Verification failed: ${verification.label}`, summary);
  }
  return summary;
}

/** Runs verification; an exception counts as a failed verification instead of escaping the workflow. */
async function safeVerify(
  strategy: EcosystemStrategy,
  module: ProjectModule,
  rootDir: string,
  options: VerificationOptions,
): Promise<VerificationResult> {
  try {
    return await strategy.verifier.verify(module, rootDir, options);
  } catch (err) {
    return { status: 'warn', details: message(err), label: options.customLabel || 'Verification' };
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function displayPaths(files: string[], rootDir: string): string[] {
  return files.map((file) => relative(rootDir, file).replace(/\\/g, '/'));
}
