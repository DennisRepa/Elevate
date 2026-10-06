/**
 * Elevate — npm updater.
 *
 * Writes new ranges to the module's package.json (keeping its indentation),
 * runs `npm install` at the repository root and verifies that aligned
 * workspace dependencies are linked rather than installed from a registry.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { InstallError } from '../../domain/ports.js';
import type { ApplyOutcome, DependencyUpdaterPort } from '../../domain/ports.js';
import type { ProjectModule, UpdateCandidate } from '../../domain/models.js';
import { runCommand, tail } from '../shared/process.js';
import { UnsupportedPackageManagerError, assertNpmManaged, detectPackageManager } from './npm-package-manager.js';
import { DEPENDENCY_SECTIONS } from './npm-scanner.js';
import { findUnlinkedWorkspaceDependencies, readLockfile } from './npm-lockfile.js';

const INSTALL_TIMEOUT_MS = 10 * 60_000;

export class NpmUpdaterAdapter implements DependencyUpdaterPort {
  affectedFiles(module: ProjectModule, rootDir: string): string[] {
    return [
      join(module.path, 'package.json'),
      join(rootDir, 'package.json'),
      join(rootDir, 'package-lock.json'),
      join(rootDir, 'npm-shrinkwrap.json'),
    ];
  }

  async applyUpdates(
    module: ProjectModule,
    rootDir: string,
    updates: UpdateCandidate[],
    onProgress: (stepMessage: string) => void,
  ): Promise<ApplyOutcome> {
    try {
      assertNpmManaged(rootDir);
    } catch (err) {
      if (err instanceof UnsupportedPackageManagerError) throw new InstallError(err.message);
      throw err;
    }

    const pkgPath = join(module.path, 'package.json');
    let source: string;
    let pkg: any;
    try {
      source = readFileSync(pkgPath, 'utf8');
      pkg = JSON.parse(source);
    } catch {
      throw new InstallError(`Cannot read package.json in ${module.path}.`);
    }

    onProgress('Writing new versions to package.json…');
    for (const item of updates) {
      const name = item.coordinate.artifact;
      // Every section that declares the name receives the range.
      for (const section of DEPENDENCY_SECTIONS) {
        if (typeof pkg[section]?.[name] === 'string') pkg[section][name] = item.newRange;
      }
    }
    writeFileSync(pkgPath, serializeLike(source, pkg), 'utf8');

    onProgress('Running npm install…');
    const install = await runCommand('npm', ['install'], { cwd: rootDir, timeoutMs: INSTALL_TIMEOUT_MS });
    if (install.exitCode !== 0) {
      const reason = install.timedOut ? 'npm install timed out' : 'npm install failed';
      throw new InstallError(reason, tail(install.stderr || install.stdout));
    }

    onProgress('Checking workspace links in package-lock.json…');
    const integrityViolations = verifyAlignedLinks(module, rootDir, updates);

    const combined = `${install.stdout}\n${install.stderr}`;
    const audit = parseAuditSummary(combined);
    const fundingMatch = combined.match(/(\d+ packages? (?:is|are) looking for funding)/i);

    return {
      updatedCount: updates.length,
      auditMessage: audit.message,
      auditSeverity: audit.severity,
      fundingMessage: fundingMatch ? fundingMatch[0] : undefined,
      integrityViolations,
    };
  }

  async resync(_module: ProjectModule, rootDir: string, onProgress: (stepMessage: string) => void): Promise<void> {
    // Nothing was installed in a repository npm does not manage, so there is nothing to restore.
    if (detectPackageManager(rootDir).name !== 'npm') return;

    onProgress('Restoring node_modules (npm install)…');
    const result = await runCommand('npm', ['install'], { cwd: rootDir, timeoutMs: INSTALL_TIMEOUT_MS });
    if (result.exitCode !== 0) {
      throw new InstallError('npm install failed while restoring the previous state', tail(result.stderr));
    }
  }
}

/**
 * A line of npm's vulnerability summary: `found 0 vulnerabilities`,
 * `1 high severity vulnerability`, `5 vulnerabilities (1 low, 2 moderate, 2 high)`
 * or npm 6's `found 3 vulnerabilities (1 low, 2 high)`. Anchored to the whole
 * line so other numbers in npm's output are not mistaken for a count.
 */
const VULNERABILITY_LINE = /^(?:found\s+)?(\d+)\s+(?:(?:info|low|moderate|high|critical)\s+severity\s+)?vulnerabilit(?:y|ies)\b.*$/i;

/**
 * Reads the vulnerability summary from the output of `npm install`. Zero
 * vulnerabilities, or no summary at all, is clean; otherwise the result is a
 * warning that quotes npm's own line.
 */
export function parseAuditSummary(output: string): { message: string; severity: 'clean' | 'warn' } {
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(VULNERABILITY_LINE);
    if (match && Number(match[1]) > 0) return { message: line.trim(), severity: 'warn' };
  }
  return { message: 'No known vulnerabilities found.', severity: 'clean' };
}

/** Every aligned workspace dependency must now be linked to its workspace. */
function verifyAlignedLinks(module: ProjectModule, rootDir: string, updates: UpdateCandidate[]): string[] {
  const aligned = updates.filter((u) => u.origin.kind === 'workspace').map((u) => u.coordinate.identifier);
  if (aligned.length === 0) return [];

  const lockfile = readLockfile(rootDir);
  if (!lockfile) return ['package-lock.json is missing; workspace links cannot be verified'];

  const moduleRelPath = relative(rootDir, module.path).replace(/\\/g, '/');
  return findUnlinkedWorkspaceDependencies(lockfile, moduleRelPath, aligned);
}

/** Serialises JSON with the indentation and final newline of the original file. */
function serializeLike(original: string, value: unknown): string {
  const indent = original.match(/^[ \t]+(?=")/m)?.[0] ?? '  ';
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const body = JSON.stringify(value, null, indent).replace(/\n/g, newline);
  return original.endsWith('\n') ? body + newline : body;
}
