/**
 * Elevate — Maven invocation.
 *
 * Prefers the project's Maven Wrapper (`mvnw` / `mvnw.cmd`), which pins the
 * Maven version the project is built with, and falls back to `mvn` on the
 * PATH. Without either, Maven features fail with `MavenUnavailableError`
 * instead of silently degrading: Elevate cannot verify Maven updates without
 * Maven, so offering them would be unsafe.
 */

import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { runCommand } from '../shared/process.js';
import type { RunResult } from '../shared/process.js';

/** Thrown when neither a Maven Wrapper nor `mvn` is available. */
export class MavenUnavailableError extends Error {
  constructor() {
    super('Maven is not available: no Maven Wrapper (mvnw) in the project and no `mvn` on the PATH.');
    this.name = 'MavenUnavailableError';
  }
}

/** Thrown when a Maven invocation fails. */
export class MavenCommandError extends Error {
  constructor(message: string, readonly output: string) {
    super(message);
    this.name = 'MavenCommandError';
  }
}

const IS_WINDOWS = process.platform === 'win32';
const WRAPPER = IS_WINDOWS ? 'mvnw.cmd' : 'mvnw';

/** Arguments for non-interactive, log-friendly output. */
const BATCH_ARGS = ['-B', '--no-transfer-progress'];

let mvnOnPath: Promise<boolean> | undefined;

/**
 * Finds the Maven Wrapper closest to `fromDir`, searching upwards but never
 * above `rootDir`.
 */
export function findMavenWrapper(fromDir: string, rootDir: string): string | undefined {
  let dir = resolve(fromDir);
  const root = resolve(rootDir);
  for (;;) {
    const candidate = join(dir, WRAPPER);
    if (existsSync(candidate)) return candidate;
    if (dir === root || relative(root, dir).startsWith('..')) return undefined;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Names a file relative to the working directory a process runs in, with the
 * platform's separators. The working directory is handed to the process
 * directly, so the directory the repository lives in (which may contain
 * characters cmd.exe would interpret) never appears in an argument. A file
 * that cannot be expressed relative to `cwd` (another drive on Windows) is
 * returned unchanged.
 */
export function relativeToCwd(cwd: string, file: string): string {
  const path = relative(cwd, file);
  return isAbsolute(path) ? file : path || '.';
}

export interface MavenRunOptions {
  /** Working directory; also the starting point of the wrapper lookup. */
  cwd: string;
  /** Repository root; the wrapper lookup does not go above it. */
  rootDir: string;
  timeoutMs?: number;
}

/** Runs Maven in batch mode. Resolves with the result even for a failed build. */
export async function runMaven(args: string[], options: MavenRunOptions): Promise<RunResult> {
  const wrapper = findMavenWrapper(options.cwd, options.rootDir);
  const run = { cwd: options.cwd, timeoutMs: options.timeoutMs };

  if (wrapper) {
    // Addressed by its relative path like every other file; a wrapper in the
    // working directory itself needs an explicit `.` so it is not searched on the PATH.
    const relativeWrapper = relativeToCwd(options.cwd, wrapper);
    const path = isAbsolute(relativeWrapper) || relativeWrapper.includes(sep) ? relativeWrapper : `.${sep}${relativeWrapper}`;
    // On POSIX the wrapper may lack the executable bit after a checkout.
    return IS_WINDOWS
      ? runCommand(path, [...BATCH_ARGS, ...args], run)
      : runCommand('sh', [path, ...BATCH_ARGS, ...args], run);
  }

  mvnOnPath ??= runCommand('mvn', ['-v'], { cwd: options.cwd, timeoutMs: 30_000 }).then(
    (result) => result.exitCode === 0,
    () => false,
  );
  if (!(await mvnOnPath)) throw new MavenUnavailableError();

  return runCommand('mvn', [...BATCH_ARGS, ...args], run);
}

/** Extracts Maven's error lines for a concise failure message. */
export function mavenErrors(output: string): string {
  const errors = output
    .split(/\r?\n/)
    .filter((line) => line.startsWith('[ERROR]'))
    .map((line) => line.replace(/^\[ERROR\]\s?/, ''))
    .filter((line) => line.trim() && !line.startsWith('->') && !line.includes('Re-run Maven'));
  return (errors.length > 0 ? errors : output.trim().split(/\r?\n/).slice(-10)).slice(0, 12).join('\n');
}
