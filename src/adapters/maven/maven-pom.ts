/**
 * Elevate — raw POM model.
 *
 * Reads a pom.xml exactly as written, without inheritance or interpolation,
 * and keeps references to the XML elements so versions can later be edited in
 * place. Elements inside `<profiles>` are deliberately ignored: whether a
 * profile is active depends on the build environment, and every location
 * found here is cross-checked against Maven's effective POM before editing.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { child, childAt, childText, children, parseXml } from '../shared/xml.js';
import type { XmlElement } from '../shared/xml.js';

export interface PomDependency {
  groupId: string;
  artifactId: string;
  version?: string;
  type?: string;
  classifier?: string;
  scope?: string;
  /** The `<version>` element, when present. */
  versionElement?: XmlElement;
}

export interface PomParent {
  groupId: string;
  artifactId: string;
  version: string;
  relativePath?: string;
  versionElement?: XmlElement;
}

export interface PomProperty {
  value: string;
  element: XmlElement;
}

export interface PomModel {
  /** Absolute path of the pom.xml. */
  file: string;
  /** Directory containing the pom.xml. */
  dir: string;
  /** Own groupId, if declared (otherwise inherited from the parent). */
  groupId?: string;
  artifactId: string;
  /** Own version, if declared (otherwise inherited from the parent). */
  version?: string;
  versionElement?: XmlElement;
  name?: string;
  packaging: string;
  parent?: PomParent;
  properties: Map<string, PomProperty>;
  dependencies: PomDependency[];
  managedDependencies: PomDependency[];
  /** Entries of `<modules>`, as written. */
  modules: string[];
}

/** Parses a pom.xml file. Throws `XmlParseError` for malformed XML. */
export function readPom(file: string): PomModel {
  const source = readFileSync(file, 'utf8');
  return parsePom(source, file);
}

/** Parses POM source text. */
export function parsePom(source: string, file: string): PomModel {
  const project = parseXml(source, file);

  const parentElement = child(project, 'parent');
  const parent: PomParent | undefined = parentElement
    ? {
        groupId: childText(parentElement, 'groupId') ?? '',
        artifactId: childText(parentElement, 'artifactId') ?? '',
        version: childText(parentElement, 'version') ?? '',
        relativePath: child(parentElement, 'relativePath')?.text.trim(),
        versionElement: child(parentElement, 'version'),
      }
    : undefined;

  const properties = new Map<string, PomProperty>();
  for (const element of child(project, 'properties')?.children ?? []) {
    properties.set(element.name, { value: element.text.trim(), element });
  }

  return {
    file,
    dir: dirname(file),
    groupId: childText(project, 'groupId'),
    artifactId: childText(project, 'artifactId') ?? 'unknown',
    version: childText(project, 'version'),
    versionElement: child(project, 'version'),
    name: childText(project, 'name'),
    packaging: childText(project, 'packaging') ?? 'jar',
    parent,
    properties,
    dependencies: readDependencies(child(project, 'dependencies')),
    managedDependencies: readDependencies(childAt(project, 'dependencyManagement', 'dependencies')),
    modules: children(child(project, 'modules'), 'module').map((m) => m.text.trim()).filter(Boolean),
  };
}

function readDependencies(container: XmlElement | undefined): PomDependency[] {
  return children(container, 'dependency').map((element) => ({
    groupId: childText(element, 'groupId') ?? '',
    artifactId: childText(element, 'artifactId') ?? '',
    version: childText(element, 'version'),
    type: childText(element, 'type'),
    classifier: childText(element, 'classifier'),
    scope: childText(element, 'scope'),
    versionElement: child(element, 'version'),
  }));
}

/**
 * Resolves the pom.xml that `<parent><relativePath>` points to, following
 * Maven's default of `../pom.xml`. An empty `<relativePath/>` explicitly
 * disables the lookup.
 */
export function parentPomFile(pom: PomModel): string | undefined {
  if (!pom.parent) return undefined;
  const relativePath = pom.parent.relativePath ?? '../pom.xml';
  if (relativePath === '') return undefined;
  let candidate = resolve(pom.dir, relativePath);
  if (existsSync(candidate) && statSync(candidate).isDirectory()) candidate = join(candidate, 'pom.xml');
  return existsSync(candidate) ? candidate : undefined;
}

/** Built-in `project.*` expressions resolvable without running Maven. */
function builtinProperty(name: string, module: PomModel): string | undefined {
  switch (name) {
    case 'project.groupId':
    case 'pom.groupId':
      return module.groupId ?? module.parent?.groupId;
    case 'project.artifactId':
    case 'pom.artifactId':
      return module.artifactId;
    case 'project.version':
    case 'pom.version':
      return module.version ?? module.parent?.version;
    case 'project.parent.groupId':
      return module.parent?.groupId;
    case 'project.parent.version':
      return module.parent?.version;
    default:
      return undefined;
  }
}

/** Finds the nearest definition of a property, searching the module first. */
export function findProperty(
  name: string,
  chain: readonly PomModel[],
): { pom: PomModel; property: PomProperty } | undefined {
  for (const pom of chain) {
    const property = pom.properties.get(name);
    if (property) return { pom, property };
  }
  return undefined;
}

/**
 * Interpolates `${...}` expressions with properties from the inheritance
 * chain (module first, as in Maven) and the built-in `project.*` values of
 * the module. Unresolvable expressions are left in place.
 */
export function interpolate(text: string, chain: readonly PomModel[], depth = 0): string {
  if (depth > 10 || !text.includes('${')) return text;
  const module = chain[0];
  const replaced = text.replace(/\$\{([^}]+)\}/g, (expression, name: string) => {
    const builtin = module ? builtinProperty(name, module) : undefined;
    if (builtin !== undefined) return builtin;
    return findProperty(name, chain)?.property.value ?? expression;
  });
  return replaced === text ? text : interpolate(replaced, chain, depth + 1);
}

/** Matches a whole-value property reference such as `${guava.version}`. */
export function propertyReference(text: string): string | undefined {
  return text.match(/^\$\{([^}]+)\}$/)?.[1];
}
