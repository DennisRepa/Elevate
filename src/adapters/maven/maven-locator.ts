/**
 * Elevate — locates where a Maven dependency's version is declared.
 *
 * Maven's effective POM says which version applies, not where it is written.
 * An update must change the declaring literal: a `<version>` in the module,
 * a `<dependencyManagement>` entry or a property — possibly in a parent POM.
 *
 * The lookup follows Maven's rules on the raw POMs of the inheritance chain
 * and then cross-checks the literal against the effective version. If they
 * differ (active profiles, command-line properties, unusual inheritance) the
 * location is reported as a mismatch instead of guessed. Declarations outside
 * the repository (external parent POMs, imported BOMs) are reported as such:
 * they cannot be edited here; the parent or BOM itself has to be updated.
 */

import { relative } from 'node:path';
import type { VersionDeclaration } from '../../domain/models.js';
import type { XmlElement } from '../shared/xml.js';
import { findProperty, interpolate, propertyReference } from './maven-pom.js';
import type { PomDependency, PomModel } from './maven-pom.js';

export type DeclarationLookup =
  | { found: true; declaration: VersionDeclaration; element: XmlElement; value: string }
  | { found: false; reason: 'managed-externally' | 'declaration-mismatch'; detail: string };

interface Target {
  groupId: string;
  artifactId: string;
  /** The version Maven resolved for this dependency. */
  effectiveVersion: string;
}

/**
 * Locates the version of a dependency used by the first POM of `chain`.
 *
 * Search order, as Maven applies it: an explicit `<version>` in the module's
 * own dependency, then one inherited from a parent's `<dependencies>`, then
 * `<dependencyManagement>` from the module upwards.
 */
export function locateDependencyVersion(
  chain: readonly PomModel[],
  target: Target,
  rootDir: string,
): DeclarationLookup {
  for (const pom of chain) {
    const dependency = findDependency(pom.dependencies, target, chain);
    if (!dependency) continue;
    // The nearest declaration wins entirely; without a version it is managed.
    if (!dependency.versionElement) break;
    return resolveLiteral(pom, 'dependency', dependency.versionElement, chain, target, rootDir);
  }
  return locateManagedVersion(chain, target, rootDir);
}

/** Locates a `<dependencyManagement>` version, searching from the module upwards. */
export function locateManagedVersion(
  chain: readonly PomModel[],
  target: Target,
  rootDir: string,
): DeclarationLookup {
  for (const pom of chain) {
    const managed = findDependency(pom.managedDependencies, target, chain);
    if (managed?.versionElement) {
      return resolveLiteral(pom, 'dependency-management', managed.versionElement, chain, target, rootDir);
    }
  }
  return {
    found: false,
    reason: 'managed-externally',
    detail: 'version is managed outside this repository (external parent POM or imported BOM)',
  };
}

/** Locates the `<parent>` version of the module (for external parents). */
export function locateParentVersion(module: PomModel, target: Target, rootDir: string): DeclarationLookup {
  const element = module.parent?.versionElement;
  if (!element) {
    return { found: false, reason: 'declaration-mismatch', detail: 'parent has no <version> element' };
  }
  return resolveLiteral(module, 'parent', element, [module], target, rootDir);
}

function findDependency(
  dependencies: readonly PomDependency[],
  target: Target,
  chain: readonly PomModel[],
): PomDependency | undefined {
  return dependencies.find(
    (dep) =>
      dep.scope !== 'import' &&
      interpolate(dep.groupId, chain) === target.groupId &&
      interpolate(dep.artifactId, chain) === target.artifactId,
  );
}

/**
 * Follows property references from a `<version>` element to the literal that
 * finally holds the value. Properties resolve from the module upwards — a
 * child's definition overrides the parent's, even for a version written in
 * the parent.
 */
function resolveLiteral(
  pom: PomModel,
  kind: 'dependency' | 'dependency-management' | 'parent',
  versionElement: XmlElement,
  chain: readonly PomModel[],
  target: Target,
  rootDir: string,
): DeclarationLookup {
  let file = pom.file;
  let element = versionElement;
  let value = versionElement.text.trim();
  let propertyName: string | undefined;

  for (let depth = 0; depth < 10; depth++) {
    const reference = propertyReference(value);
    if (!reference) break;
    if (reference.startsWith('project.') || reference.startsWith('pom.')) {
      return {
        found: false,
        reason: 'declaration-mismatch',
        detail: `version is the expression \${${reference}}, not an editable value`,
      };
    }
    const definition = findProperty(reference, chain);
    if (!definition) {
      return {
        found: false,
        reason: 'managed-externally',
        detail: `property \${${reference}} is defined outside this repository`,
      };
    }
    file = definition.pom.file;
    element = definition.property.element;
    value = definition.property.value;
    propertyName = reference;
  }

  if (value.includes('${')) {
    return {
      found: false,
      reason: 'declaration-mismatch',
      detail: `version '${value}' combines several expressions`,
    };
  }

  if (value !== target.effectiveVersion) {
    return {
      found: false,
      reason: 'declaration-mismatch',
      detail: `declared '${value}' but Maven resolves '${target.effectiveVersion}' (profile or command-line override?)`,
    };
  }

  const declaration: VersionDeclaration = {
    file,
    kind: propertyName ? 'property' : kind,
    propertyName,
    displayPath: relative(rootDir, file).replace(/\\/g, '/'),
  };
  return { found: true, declaration, element, value };
}
