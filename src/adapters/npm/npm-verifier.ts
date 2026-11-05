/**
 * Elevate — npm verification.
 *
 * Without a configured `postUpdateScript`, verification runs `npm ls` at the
 * repository root (npm) or `pnpm install --frozen-lockfile --lockfile-only`
 * (pnpm; `pnpm ls` exits 0 for missing dependencies, so it cannot judge).
 */

import type { VerificationOptions, VerificationPort, VerificationResult } from '../../domain/ports.js';
import type { ProjectModule } from '../../domain/models.js';
import { runCommand, runShellScript, tail } from '../shared/process.js';
import {
  PackageManagerNotFoundError,
  UnsupportedPackageManagerError,
  prepareSupportedPackageManager,
} from './npm-package-manager.js';
import { commands } from './npm-commands.js';

const VERIFY_TIMEOUT_MS = 10 * 60_000;

export class NpmVerificationAdapter implements VerificationPort {
  async verify(
    _module: ProjectModule,
    rootDir: string,
    options: VerificationOptions = {},
  ): Promise<VerificationResult> {
    let manager: 'npm' | 'pnpm' = 'npm';
    if (!options.customScript) {
      // Judging a tree a different package manager installed would be wrong.
      try {
        manager = await prepareSupportedPackageManager(rootDir);
      } catch (err) {
        if (err instanceof UnsupportedPackageManagerError || err instanceof PackageManagerNotFoundError) {
          return { status: 'warn', details: err.message, label: options.customLabel || 'Dependency verification' };
        }
        throw err;
      }
    }
    const defaultLabel =
      manager === 'pnpm'
        ? 'Lockfile consistency (pnpm install --frozen-lockfile)'
        : 'Dependency tree integrity (npm ls)';
    const label = options.customLabel || options.customScript || defaultLabel;

    const verify = commands.verify(manager);
    const result = options.customScript
      ? await runShellScript(options.customScript, { cwd: rootDir, timeoutMs: VERIFY_TIMEOUT_MS })
      : await runCommand(verify.command, verify.args, { cwd: rootDir, timeoutMs: VERIFY_TIMEOUT_MS });

    if (result.exitCode === 0) {
      const details =
        manager === 'pnpm' && !options.customScript
          ? 'pnpm-lock.yaml is up to date with all package.json files.'
          : 'All dependencies are installed and consistent.';
      return { status: 'clean', details, label };
    }
    const output =
      manager === 'pnpm' && !options.customScript
        ? tail(`${result.stdout}\n${result.stderr}`)
        : tail(result.stderr || result.stdout);
    return { status: 'warn', details: result.timedOut ? 'Verification timed out.' : output, label };
  }
}
