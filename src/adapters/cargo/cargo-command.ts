/**
 * Elevate — Cargo invocation.
 *
 * Runs `cargo` from the PATH in a given working directory. Without it, Cargo
 * features fail with `CargoUnavailableError` instead of silently degrading.
 */

import { runCommand } from '../shared/process.js';
import type { RunResult } from '../shared/process.js';

/** Thrown when `cargo` cannot be started. */
export class CargoUnavailableError extends Error {
  constructor() {
    super('Cargo is not available: no `cargo` on the PATH. Install Rust (https://rustup.rs).');
    this.name = 'CargoUnavailableError';
  }
}

export async function runCargo(args: string[], options: { cwd: string; timeoutMs?: number }): Promise<RunResult> {
  let result: RunResult;
  try {
    result = await runCommand('cargo', args, options);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new CargoUnavailableError();
    throw err;
  }
  if (looksLikeMissingCommand(result) && !(await cargoStarts(options.cwd))) throw new CargoUnavailableError();
  return result;
}

/**
 * On Windows the command runs through cmd.exe, which reports a missing program
 * as an ordinary failure (exit code 1 and a message in the user's language), not
 * as ENOENT. Cargo itself always prefixes its failures with "error", so a failure
 * without output on stdout and without that prefix is worth one `cargo --version`.
 */
function looksLikeMissingCommand(result: RunResult): boolean {
  return (
    process.platform === 'win32' && result.exitCode !== 0 && !result.stdout.trim() && !/^error/m.test(result.stderr)
  );
}

async function cargoStarts(cwd: string): Promise<boolean> {
  try {
    return (await runCommand('cargo', ['--version'], { cwd, timeoutMs: 30_000 })).exitCode === 0;
  } catch {
    return false;
  }
}

/** Cargo's error lines for a concise failure message. */
export function cargoErrors(output: string): string {
  const lines = output.split(/\r?\n/);
  const errors = lines.filter((l) => /^error(\[E\d+\])?:/.test(l));
  const summary = (errors.length > 0 ? errors : lines.filter((l) => l.trim()).slice(-10)).slice(0, 12);
  if (/toolchain '.+' is not installed/.test(output)) {
    summary.push('Install it with `rustup toolchain install` (the project pins it in rust-toolchain.toml).');
  }
  return summary.join('\n');
}
