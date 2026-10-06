/**
 * Elevate — Maven updater.
 *
 * Writes each new version to the literal that declares it — a dependency's
 * `<version>`, a `<dependencyManagement>` entry, a `<parent>` version or a
 * property, possibly in a parent POM. Edits splice the original text, so
 * formatting and comments stay intact, and each edit checks that the file
 * still holds the value seen during the scan.
 *
 * Dependency resolution is left to the verification step, which builds the
 * affected modules.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { InstallError } from '../../domain/ports.js';
import type { ApplyOutcome, DependencyUpdaterPort } from '../../domain/ports.js';
import type { ProjectModule, UpdateCandidate, VersionDeclaration } from '../../domain/models.js';
import { StaleEditError, applyTextEdits } from '../shared/xml.js';
import type { TextEdit, XmlElement } from '../shared/xml.js';
import { interpolate, parsePom } from './maven-pom.js';
import type { PomDependency, PomModel } from './maven-pom.js';
import { MavenProject } from './maven-project.js';

export class MavenUpdaterAdapter implements DependencyUpdaterPort {
  affectedFiles(module: ProjectModule, _rootDir: string, updates: UpdateCandidate[]): string[] {
    const files = new Set(updates.map((u) => resolve(u.declaration?.file ?? join(module.path, 'pom.xml'))));
    return [...files];
  }

  async applyUpdates(
    module: ProjectModule,
    rootDir: string,
    updates: UpdateCandidate[],
    onProgress: (stepMessage: string) => void,
  ): Promise<ApplyOutcome> {
    const project = MavenProject.load(rootDir);
    const byFile = new Map<string, UpdateCandidate[]>();
    for (const update of updates) {
      if (!update.declaration) {
        throw new InstallError(`No version declaration known for ${update.coordinate.identifier}; rescan the module.`);
      }
      const file = resolve(update.declaration.file);
      byFile.set(file, [...(byFile.get(file) ?? []), update]);
    }

    // Compute every edit before writing anything, so a stale or conflicting
    // edit in the second file does not leave the first one half-updated.
    const writes: { file: string; content: string }[] = [];
    for (const [file, fileUpdates] of byFile) {
      onProgress(`Preparing ${fileUpdates.length} change(s) in ${fileUpdates[0]!.declaration!.displayPath}…`);
      const source = readFileSync(file, 'utf8');
      const pom = parsePom(source, file);
      const chain = project.pomAt(file) ? project.chainOf(project.pomAt(file)!).poms : [pom];
      const edits = collectEdits(pom, [pom, ...chain.slice(1)], fileUpdates);
      try {
        writes.push({ file, content: applyTextEdits(source, edits) });
      } catch (err) {
        if (err instanceof StaleEditError) throw new InstallError(`${file}: ${err.message}`);
        throw err;
      }
    }

    onProgress('Writing POM files…');
    for (const write of writes) writeFileSync(write.file, write.content, 'utf8');

    return {
      updatedCount: updates.length,
      auditMessage: `Updated ${updates.length} version declaration(s) in ${writes.length} POM file(s).`,
      auditSeverity: 'clean',
      integrityViolations: [],
    };
  }

  async resync(): Promise<void> {
    // Maven keeps no installed state next to the POMs; restoring them suffices.
  }
}

/** Maps updates to text edits; updates sharing one literal must agree on the version. */
function collectEdits(pom: PomModel, chain: readonly PomModel[], updates: UpdateCandidate[]): TextEdit[] {
  const edits = new Map<XmlElement, TextEdit & { identifier: string }>();

  for (const update of updates) {
    const element = findDeclarationElement(pom, chain, update);
    if (!element) {
      throw new InstallError(
        `${update.declaration!.displayPath}: cannot find the version of ${update.coordinate.identifier} any more; rescan the module.`,
      );
    }

    const existing = edits.get(element);
    if (existing) {
      if (existing.replacement !== update.newRange) {
        throw new InstallError(
          `${update.coordinate.identifier} and ${existing.identifier} share ${describe(update.declaration!)} ` +
            `but target different versions (${update.newRange} vs ${existing.replacement}).`,
        );
      }
      continue;
    }
    edits.set(element, {
      element,
      expected: update.currentRange,
      replacement: update.newRange,
      identifier: update.coordinate.identifier,
    });
  }
  return [...edits.values()];
}

function findDeclarationElement(
  pom: PomModel,
  chain: readonly PomModel[],
  update: UpdateCandidate,
): XmlElement | undefined {
  const declaration = update.declaration!;
  const { group, artifact } = update.coordinate;

  const matches = (dep: PomDependency) =>
    interpolate(dep.groupId, chain) === group && interpolate(dep.artifactId, chain) === artifact;

  switch (declaration.kind) {
    case 'property':
      return declaration.propertyName ? pom.properties.get(declaration.propertyName)?.element : undefined;
    case 'parent':
      return pom.parent?.versionElement;
    case 'dependency':
      return pom.dependencies.find(matches)?.versionElement;
    case 'dependency-management':
      return pom.managedDependencies.find(matches)?.versionElement;
  }
}

function describe(declaration: VersionDeclaration): string {
  return declaration.kind === 'property'
    ? `the property \${${declaration.propertyName}} in ${declaration.displayPath}`
    : `a version in ${declaration.displayPath}`;
}
