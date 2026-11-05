/**
 * Elevate — Gradle invocation.
 *
 * Prefers the project's Gradle Wrapper (`gradlew` / `gradlew.bat`), which pins
 * the Gradle version the project is built with, and falls back to `gradle` on
 * the PATH (checked once per process). Without either, Gradle features fail
 * with `GradleUnavailableError` instead of silently degrading.
 *
 * `runGradle` adds no arguments of its own: callers pass the full list.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { relativeToCwd, runCommand } from '../shared/process.js';
import type { RunResult } from '../shared/process.js';

const NOT_AVAILABLE =
  'Gradle is not available: no Gradle Wrapper (gradlew) in the repository and no `gradle` on the PATH.';

/** Thrown when neither a Gradle Wrapper nor a usable `gradle` is available. */
export class GradleUnavailableError extends Error {
  constructor(message: string = NOT_AVAILABLE) {
    super(message);
    this.name = 'GradleUnavailableError';
  }
}

/** Thrown when a Gradle invocation fails. */
export class GradleCommandError extends Error {
  constructor(message: string, readonly output: string) {
    super(message);
    this.name = 'GradleCommandError';
  }
}

/** Thrown when the Gradle of the project is older than the supported minimum. */
export class GradleVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GradleVersionError';
  }
}

const IS_WINDOWS = process.platform === 'win32';
const WRAPPER = IS_WINDOWS ? 'gradlew.bat' : 'gradlew';

let gradleOnPath: Promise<void> | undefined;

/** Resets the remembered `gradle --version` check (tests only). */
export function resetGradleCheck(): void {
  gradleOnPath = undefined;
}

/**
 * Finds the Gradle Wrapper closest to `fromDir`, searching upwards but never
 * above `rootDir`.
 */
export function findGradleWrapper(fromDir: string, rootDir: string): string | undefined {
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

export interface GradleRunOptions {
  /** Working directory (the directory of the Gradle build); also where the wrapper lookup starts. */
  cwd: string;
  /** Repository root; the wrapper lookup does not go above it. */
  rootDir: string;
  timeoutMs?: number;
}

/** Drops the line every Java start prints when JAVA_TOOL_OPTIONS is set. */
function withoutPickedUp(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('Picked up '))
    .join('\n');
}

async function checkGradleOnPath(cwd: string): Promise<void> {
  let result: RunResult;
  try {
    result = await runCommand('gradle', ['--version'], { cwd, timeoutMs: 30_000 });
  } catch {
    throw new GradleUnavailableError();
  }
  if (result.timedOut) {
    throw new GradleUnavailableError('Gradle could not be started: gradle --version timed out.');
  }
  if (result.exitCode === 127 || (result.exitCode !== 0 && !result.stderr.trim() && !result.stdout.trim())) {
    throw new GradleUnavailableError();
  }
  if (result.exitCode !== 0) {
    const detail = withoutPickedUp(result.stderr || result.stdout)
      .split(/\r?\n/)
      .find((line) => line.trim());
    throw new GradleUnavailableError(`Gradle could not be started: ${detail ?? 'gradle --version failed.'}`);
  }
}

/** Runs Gradle. Resolves with the result even for a failed build. */
export async function runGradle(args: string[], options: GradleRunOptions): Promise<RunResult> {
  const wrapper = findGradleWrapper(options.cwd, options.rootDir);
  const run = { cwd: options.cwd, timeoutMs: options.timeoutMs };

  if (wrapper) {
    // Addressed by its relative path like every other file; a wrapper in the
    // working directory itself needs an explicit `.` so it is not searched on the PATH.
    const relativeWrapper = relativeToCwd(options.cwd, wrapper);
    const path =
      isAbsolute(relativeWrapper) || relativeWrapper.includes(sep) ? relativeWrapper : `.${sep}${relativeWrapper}`;
    // On POSIX the wrapper may lack the executable bit after a checkout.
    return IS_WINDOWS ? runCommand(path, args, run) : runCommand('sh', [path, ...args], run);
  }

  gradleOnPath ??= checkGradleOnPath(options.cwd);
  try {
    await gradleOnPath;
  } catch (error) {
    // A failed check is not remembered: the user may fix the installation.
    gradleOnPath = undefined;
    throw error;
  }
  return runCommand('gradle', args, run);
}

/**
 * The details of a failed run: the standard error without the "Picked up …"
 * line, cut before the line starting with "* Try:", limited to the last 30
 * lines. When the standard error is empty the standard output is used.
 */
export function gradleErrors(result: Pick<RunResult, 'stdout' | 'stderr'>): string {
  let text = withoutPickedUp(result.stderr);
  if (!text.trim()) text = withoutPickedUp(result.stdout);
  const lines = text.split(/\r?\n/);
  const tryAt = lines.findIndex((line) => line.startsWith('* Try:'));
  const kept = (tryAt >= 0 ? lines.slice(0, tryAt) : lines).slice(-30);
  return kept.join('\n').trim();
}

/**
 * Recognises a wrapper that failed to download Gradle and names the
 * `distributionUrl` of `gradle/wrapper/gradle-wrapper.properties`.
 */
export function wrapperDownloadMessage(
  result: Pick<RunResult, 'stdout' | 'stderr'>,
  options: Pick<GradleRunOptions, 'cwd' | 'rootDir'>,
): string | undefined {
  const text = result.stderr;
  if (!/org\.gradle\.wrapper\./.test(text)) return undefined;
  const exception = /Exception in thread "[^"]*" (.+)/.exec(text)?.[1]?.trim();
  if (!exception) return undefined;

  const wrapper = findGradleWrapper(options.cwd, options.rootDir);
  const propertiesFile = join(dirname(wrapper ?? join(options.cwd, WRAPPER)), 'gradle', 'wrapper', 'gradle-wrapper.properties');
  let url = 'the distributionUrl';
  try {
    const line = readFileSync(propertiesFile, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith('distributionUrl='));
    if (line) url = line.slice('distributionUrl='.length).replace(/\\:/g, ':').trim();
  } catch {
    // no properties file: the message names the setting only
  }
  return (
    `The Gradle Wrapper could not download Gradle from ${url}: ${exception}. ` +
    'Check the network connection, the proxy settings and the distributionUrl in gradle/wrapper/gradle-wrapper.properties.'
  );
}

/**
 * Builds the error for a run that did not succeed: timeout, wrapper download
 * problem, or Gradle's own words.
 *
 * @param what gerund describing the run, e.g. "describing the build"
 * @param failure sentence start for a plain failure, e.g. "Gradle could not describe the build"
 */
export function gradleFailure(
  result: RunResult,
  options: GradleRunOptions,
  what: string,
  failure: string,
  minutes: number,
): GradleCommandError {
  const output = `${result.stdout}\n${result.stderr}`.trim();
  if (result.timedOut) {
    return new GradleCommandError(`Gradle timed out after ${minutes} minutes while ${what}.`, output);
  }
  const download = wrapperDownloadMessage(result, options);
  if (download) return new GradleCommandError(download, output);
  return new GradleCommandError(`${failure}:\n${gradleErrors(result)}`, output);
}
