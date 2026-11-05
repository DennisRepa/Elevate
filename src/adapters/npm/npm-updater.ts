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
import type { RunResult } from '../shared/process.js';
import {
  PackageManagerNotFoundError,
  UnsupportedPackageManagerError,
  detectPackageManager,
  prepareSupportedPackageManager,
} from './npm-package-manager.js';
import { DEPENDENCY_SECTIONS } from './npm-scanner.js';
import { findUnlinkedWorkspaceDependencies, readLockfile } from './npm-lockfile.js';
import { commands } from './npm-commands.js';
import type { Driver } from './npm-commands.js';
import { AUDIT_TIMEOUT_MS, parsePnpmAudit, unavailable } from './pnpm-audit.js';
import type { AuditSummary } from './pnpm-audit.js';
import { findUnlinkedPnpmDependencies, readPnpmLockfile } from './pnpm-lockfile.js';
import { setCatalogRange } from './pnpm-workspace.js';

const INSTALL_TIMEOUT_MS = 10 * 60_000;

/** pnpm prints errors on stdout (9 to 11) or stderr (12), so both are quoted; npm's go to stderr. */
function failureDetails(manager: Driver, result: RunResult): string {
  return manager === 'pnpm' ? tail(`${result.stdout}\n${result.stderr}`) : tail(result.stderr || result.stdout);
}

export class NpmUpdaterAdapter implements DependencyUpdaterPort {
  affectedFiles(module: ProjectModule, rootDir: string): string[] {
    if (detectPackageManager(rootDir).name === 'pnpm') {
      return [
        join(module.path, 'package.json'),
        join(rootDir, 'package.json'),
        join(rootDir, 'pnpm-lock.yaml'),
        join(rootDir, 'pnpm-workspace.yaml'),
      ];
    }
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
    let manager: Driver;
    try {
      manager = await prepareSupportedPackageManager(rootDir);
    } catch (err) {
      if (err instanceof UnsupportedPackageManagerError || err instanceof PackageManagerNotFoundError) {
        throw new InstallError(err.message);
      }
      throw err;
    }

    // A catalog entry is written where it is declared; the module's package.json keeps its `catalog:` reference.
    const catalogUpdates = updates.filter((u) => u.declaration?.kind === 'catalog');
    const manifestUpdates = updates.filter((u) => u.declaration?.kind !== 'catalog');

    const pkgPath = join(module.path, 'package.json');
    let manifest: { source: string; pkg: any } | undefined;
    if (manifestUpdates.length > 0 || catalogUpdates.length === 0) {
      try {
        const source = readFileSync(pkgPath, 'utf8');
        manifest = { source, pkg: JSON.parse(source) };
      } catch {
        throw new InstallError(`Cannot read package.json in ${module.path}.`);
      }
    }

    if (manifest) {
      onProgress('Writing new versions to package.json…');
      for (const item of manifestUpdates) {
        const name = item.coordinate.artifact;
        // Every section that declares the name receives the range.
        for (const section of DEPENDENCY_SECTIONS) {
          if (typeof manifest.pkg[section]?.[name] === 'string') manifest.pkg[section][name] = item.newRange;
        }
      }
      writeFileSync(pkgPath, serializeLike(manifest.source, manifest.pkg), 'utf8');
    }

    if (catalogUpdates.length > 0) {
      onProgress('Writing new versions to pnpm-workspace.yaml…');
      writeCatalogRanges(catalogUpdates);
    }

    const install = commands.install(manager);
    onProgress(`Running ${manager} install…`);
    const result = await runCommand(install.command, install.args, { cwd: rootDir, timeoutMs: INSTALL_TIMEOUT_MS });
    if (result.exitCode !== 0) {
      const reason = result.timedOut ? `${manager} install timed out` : `${manager} install failed`;
      throw new InstallError(reason, failureDetails(manager, result));
    }

    const lockName = manager === 'pnpm' ? 'pnpm-lock.yaml' : 'package-lock.json';
    onProgress(`Checking workspace links in ${lockName}…`);
    const integrityViolations = verifyAlignedLinks(manager, module, rootDir, updates);

    if (manager === 'pnpm') {
      const audit = integrityViolations.length > 0 ? undefined : await runPnpmAudit(rootDir);
      return {
        updatedCount: updates.length,
        auditMessage: audit?.message ?? '',
        auditSeverity: audit?.severity ?? 'clean',
        fundingMessage: undefined,
        integrityViolations,
      };
    }

    const combined = `${result.stdout}\n${result.stderr}`;
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
    // Nothing was installed in a repository Elevate does not drive, so there is nothing to restore.
    const name = detectPackageManager(rootDir).name;
    if (name !== 'npm' && name !== 'pnpm') return;

    const restore = commands.restore(name);
    onProgress(`Restoring node_modules (${name} install)…`);
    const result = await runCommand(restore.command, restore.args, { cwd: rootDir, timeoutMs: INSTALL_TIMEOUT_MS });
    if (result.exitCode !== 0) {
      throw new InstallError(
        `${name} install failed while restoring the previous state`,
        name === 'pnpm' ? failureDetails(name, result) : tail(result.stderr),
      );
    }
  }
}

/** Replaces each catalog entry in the file that declares it, once per file. */
function writeCatalogRanges(updates: UpdateCandidate[]): void {
  const sources = new Map<string, string>();
  for (const item of updates) {
    const declaration = item.declaration!;
    try {
      let source = sources.get(declaration.file) ?? readFileSync(declaration.file, 'utf8');
      source = setCatalogRange(source, declaration.catalogName ?? 'default', item.coordinate.artifact, item.newRange);
      sources.set(declaration.file, source);
    } catch (err) {
      throw new InstallError(err instanceof Error ? err.message : `Cannot update ${declaration.displayPath}.`);
    }
  }
  for (const [file, source] of sources) writeFileSync(file, source, 'utf8');
}

/** The vulnerability summary of pnpm; an audit that gives no result is a warning, never a failure. */
async function runPnpmAudit(rootDir: string): Promise<AuditSummary> {
  try {
    const result = await runCommand('pnpm', ['audit', '--json'], { cwd: rootDir, timeoutMs: AUDIT_TIMEOUT_MS });
    if (result.timedOut) return unavailable(`pnpm audit timed out after ${AUDIT_TIMEOUT_MS / 1000} seconds`);
    return parsePnpmAudit(result.stdout);
  } catch {
    return unavailable('pnpm audit returned no result');
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
function verifyAlignedLinks(
  manager: Driver,
  module: ProjectModule,
  rootDir: string,
  updates: UpdateCandidate[],
): string[] {
  const aligned = updates.filter((u) => u.origin.kind === 'workspace').map((u) => u.coordinate.identifier);
  if (aligned.length === 0) return [];

  const moduleRelPath = relative(rootDir, module.path).replace(/\\/g, '/');
  if (manager === 'pnpm') return findUnlinkedPnpmDependencies(readPnpmLockfile(rootDir), moduleRelPath, aligned);

  const lockfile = readLockfile(rootDir);
  if (!lockfile) return ['package-lock.json is missing; workspace links cannot be verified'];
  return findUnlinkedWorkspaceDependencies(lockfile, moduleRelPath, aligned);
}

/** Serialises JSON with the indentation and final newline of the original file. */
function serializeLike(original: string, value: unknown): string {
  const indent = original.match(/^[ \t]+(?=")/m)?.[0] ?? '  ';
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const body = JSON.stringify(value, null, indent).replace(/\n/g, newline);
  return original.endsWith('\n') ? body + newline : body;
}
