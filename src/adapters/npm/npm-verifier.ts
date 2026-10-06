/**
 * Elevate — npm verification.
 *
 * Without a configured `postUpdateScript`, verification runs `npm ls` at the
 * repository root: it fails on missing, invalid or unmet dependencies across
 * all workspaces and needs no project-specific script.
 */

import type { VerificationOptions, VerificationPort, VerificationResult } from '../../domain/ports.js';
import type { ProjectModule } from '../../domain/models.js';
import { runCommand, runShellScript, tail } from '../shared/process.js';
import { UnsupportedPackageManagerError, assertNpmManaged } from './npm-package-manager.js';

const VERIFY_TIMEOUT_MS = 10 * 60_000;

export class NpmVerificationAdapter implements VerificationPort {
  async verify(
    _module: ProjectModule,
    rootDir: string,
    options: VerificationOptions = {},
  ): Promise<VerificationResult> {
    const label = options.customLabel || options.customScript || 'Dependency tree integrity (npm ls)';

    if (!options.customScript) {
      // `npm ls` would judge a tree npm did not install.
      try {
        assertNpmManaged(rootDir);
      } catch (err) {
        if (err instanceof UnsupportedPackageManagerError) return { status: 'warn', details: err.message, label };
        throw err;
      }
    }

    const result = options.customScript
      ? await runShellScript(options.customScript, { cwd: rootDir, timeoutMs: VERIFY_TIMEOUT_MS })
      : await runCommand('npm', ['ls'], { cwd: rootDir, timeoutMs: VERIFY_TIMEOUT_MS });

    if (result.exitCode === 0) {
      return { status: 'clean', details: 'All dependencies are installed and consistent.', label };
    }
    return {
      status: 'warn',
      details: result.timedOut ? 'Verification timed out.' : tail(result.stderr || result.stdout),
      label,
    };
  }
}
