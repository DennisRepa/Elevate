/**
 * Elevate — package manager detection.
 *
 * Elevate's Node.js support drives npm and pnpm. In a repository managed by
 * Yarn or Bun, running either would create a second lockfile and a
 * `node_modules` layout the project does not use, so such repositories are
 * recognised and refused.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { findCheckoutBoundary } from '../shared/checkout.js';
import { runCommand } from '../shared/process.js';

export type PackageManagerName = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface DetectedPackageManager {
  name: PackageManagerName;
  /** What decided: the `packageManager` field, a file name, or the lack of both. */
  evidence: string;
}

/** Marker files per package manager, checked in this order; the first match decides. */
const MARKER_FILES: readonly [PackageManagerName, readonly string[]][] = [
  ['npm', ['package-lock.json', 'npm-shrinkwrap.json']],
  ['pnpm', ['pnpm-lock.yaml', 'pnpm-workspace.yaml']],
  ['yarn', ['yarn.lock', '.yarnrc.yml']],
  ['bun', ['bun.lock', 'bun.lockb']],
];

/** Thrown when the repository is managed by a package manager Elevate does not drive (Yarn, Bun). */
export class UnsupportedPackageManagerError extends Error {
  constructor(detected: DetectedPackageManager) {
    super(
      `This repository is managed by ${detected.name} (${detected.evidence}). ` +
        `Elevate supports npm and pnpm for Node.js projects; using either here would create a lockfile next to ` +
        `${detected.name}'s. Nothing was changed.`,
    );
    this.name = 'UnsupportedPackageManagerError';
  }
}

/**
 * Recognises the package manager that manages `dir`. Starting at `dir`, each
 * directory up to the checkout boundary is examined; the first one with a
 * decisive finding wins. This matters when Elevate is started inside a
 * workspace package: pnpm keeps its workspace file and lockfile at the
 * workspace root, not next to the package. Without a checkout boundary only
 * `dir` itself is examined: files of unrelated directories above it say
 * nothing about this project.
 */
export function detectPackageManager(dir: string): DetectedPackageManager {
  const boundary = findCheckoutBoundary(dir);
  let current = resolve(dir);
  for (;;) {
    const found = detectIn(current);
    if (found) return found;
    const parent = dirname(current);
    if (boundary === undefined || current === boundary || parent === current) break;
    current = parent;
  }
  return { name: 'npm', evidence: 'no other package manager detected' };
}

/** The decisive finding in one directory, if any. */
function detectIn(dir: string): DetectedPackageManager | undefined {
  const declared = readPackageManagerField(dir);
  const name = declared?.match(/^(npm|pnpm|yarn|bun)@/)?.[1] as PackageManagerName | undefined;
  if (declared && name) return { name, evidence: `"packageManager": "${declared}" in package.json` };

  for (const [manager, files] of MARKER_FILES) {
    const found = files.find((file) => existsSync(join(dir, file)));
    if (found) return { name: manager, evidence: found };
  }
  return undefined;
}

/**
 * Returns the package manager Elevate drives for this repository; throws
 * `UnsupportedPackageManagerError` for Yarn and Bun.
 */
export function assertSupportedPackageManager(rootDir: string): 'npm' | 'pnpm' {
  const detected = detectPackageManager(rootDir);
  if (detected.name === 'npm' || detected.name === 'pnpm') return detected.name;
  throw new UnsupportedPackageManagerError(detected);
}

/** Thrown when pnpm is required but cannot be run. */
export class PackageManagerNotFoundError extends Error {
  constructor(reason: string, detected: DetectedPackageManager) {
    super(
      `pnpm could not be run in this repository (${reason}). This repository is managed by pnpm ` +
        `(${detected.evidence}); install pnpm or enable Corepack (corepack enable). Nothing was changed.`,
    );
    this.name = 'PackageManagerNotFoundError';
  }
}

const VERSION_TIMEOUT_MS = 15_000;
const verifiedRoots = new Set<string>();

/**
 * Makes sure `pnpm --version` succeeds before anything is touched. A success is
 * remembered per root for the life of the process; a failure is not.
 */
export async function ensurePnpmRunnable(rootDir: string, detected: DetectedPackageManager): Promise<void> {
  const key = resolve(rootDir);
  if (verifiedRoots.has(key)) return;

  let reason: string | undefined;
  try {
    const result = await runCommand('pnpm', ['--version'], { cwd: rootDir, timeoutMs: VERSION_TIMEOUT_MS });
    if (result.timedOut) reason = 'pnpm --version timed out';
    else if (result.exitCode !== 0) {
      const line = firstLine(result.stderr) || firstLine(result.stdout);
      reason = `pnpm --version exited with code ${result.exitCode}: ${line}`;
    }
  } catch {
    reason = 'command not found';
  }
  if (reason !== undefined) throw new PackageManagerNotFoundError(reason, detected);
  verifiedRoots.add(key);
}

/**
 * Guard for operations on a repository: refuses Yarn and Bun, and for pnpm
 * checks that it can run. Returns the manager to drive.
 */
export async function prepareSupportedPackageManager(rootDir: string): Promise<'npm' | 'pnpm'> {
  const manager = assertSupportedPackageManager(rootDir);
  if (manager === 'pnpm') await ensurePnpmRunnable(rootDir, detectPackageManager(rootDir));
  return manager;
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).find((l) => l.trim() !== '')?.trim() ?? '';
}

function readPackageManagerField(rootDir: string): string | undefined {
  try {
    const field = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))?.packageManager;
    return typeof field === 'string' ? field : undefined;
  } catch {
    return undefined;
  }
}
