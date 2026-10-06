/**
 * Elevate — package manager detection.
 *
 * Elevate's Node.js support drives npm: it runs `npm install` and checks
 * `package-lock.json`. In a repository managed by pnpm, Yarn or Bun that would
 * create a second lockfile and a `node_modules` layout the project does not
 * use, so such repositories are recognised and refused.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { findCheckoutBoundary } from '../shared/checkout.js';

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

/** Thrown when the repository is managed by a package manager other than npm. */
export class UnsupportedPackageManagerError extends Error {
  constructor(detected: DetectedPackageManager) {
    super(
      `This repository is managed by ${detected.name} (${detected.evidence}). ` +
        `Elevate supports npm for Node.js projects; using it here would create an npm lockfile next to ` +
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

/** Throws `UnsupportedPackageManagerError` unless the repository is managed by npm. */
export function assertNpmManaged(rootDir: string): void {
  const detected = detectPackageManager(rootDir);
  if (detected.name !== 'npm') throw new UnsupportedPackageManagerError(detected);
}

function readPackageManagerField(rootDir: string): string | undefined {
  try {
    const field = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))?.packageManager;
    return typeof field === 'string' ? field : undefined;
  } catch {
    return undefined;
  }
}
