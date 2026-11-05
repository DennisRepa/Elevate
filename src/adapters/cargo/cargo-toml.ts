/**
 * Elevate — Cargo.toml dependency declarations.
 *
 * Finds, for every dependency of a manifest, where its version is written.
 * The parser reports exact source ranges, so an update can replace just the
 * characters inside the quotes and leave comments, quote style and line
 * endings alone.
 */

import { parseTOML } from 'toml-eslint-parser';

export type DependencySection = 'dependencies' | 'dev-dependencies' | 'build-dependencies';

export interface VersionLiteral {
  value: string;
  /** Offsets of the text between the quotes. */
  start: number;
  end: number;
}

export interface DependencyDeclaration {
  /** Table key: the crate name, or its rename when `package = "…"` is used. */
  key: string;
  section: DependencySection;
  /** `cfg(…)` or target triple of a `[target.*]` table. */
  target?: string;
  /** Declared in `[workspace.dependencies]`. */
  inWorkspace: boolean;
  /** `workspace = true`: the version lives in the workspace root. */
  inherited: boolean;
  /** `package = "…"`: the real crate name behind a rename. */
  package?: string;
  version?: VersionLiteral;
}

const SECTIONS: Record<string, DependencySection> = {
  dependencies: 'dependencies',
  'dev-dependencies': 'dev-dependencies',
  dev_dependencies: 'dev-dependencies',
  'build-dependencies': 'build-dependencies',
  build_dependencies: 'build-dependencies',
};

interface Leaf {
  path: string[];
  node: any;
}

export function parseCargoManifest(source: string): DependencyDeclaration[] {
  const root = parseTOML(source).body[0] as any;
  const leaves: Leaf[] = [];

  const keyPath = (key: any): string[] => key.keys.map((k: any) => (k.type === 'TOMLBare' ? k.name : k.value));
  const visitPair = (prefix: string[], pair: any): void => {
    const path = [...prefix, ...keyPath(pair.key)];
    leaves.push({ path, node: pair.value });
    if (pair.value.type === 'TOMLInlineTable') for (const inner of pair.value.body) visitPair(path, inner);
  };

  for (const element of root.body) {
    if (element.type === 'TOMLKeyValue') visitPair([], element);
    else if (element.type === 'TOMLTable') {
      const header = keyPath(element.key);
      for (const pair of element.body) visitPair(header, pair);
      leaves.push({ path: header, node: element });
    }
  }

  const byKey = new Map<string, DependencyDeclaration>();
  for (const { path, node } of leaves) {
    const located = locateSection(path);
    if (!located || located.rest.length === 0) continue;
    const [key, field] = located.rest;
    const id = `${located.inWorkspace}|${located.target ?? ''}|${located.section}|${key}`;
    let decl = byKey.get(id);
    if (!decl) {
      decl = { key: key!, section: located.section, target: located.target, inWorkspace: located.inWorkspace, inherited: false };
      byKey.set(id, decl);
    }
    if (located.rest.length === 1 && node.type === 'TOMLValue' && node.kind === 'string') {
      decl.version = literalOf(node);
    } else if (field === 'version' && located.rest.length === 2 && node.type === 'TOMLValue' && node.kind === 'string') {
      decl.version = literalOf(node);
    } else if (field === 'workspace' && located.rest.length === 2 && node.value === true) {
      decl.inherited = true;
    } else if (field === 'package' && located.rest.length === 2 && node.type === 'TOMLValue') {
      decl.package = String(node.value);
    }
  }
  return [...byKey.values()];
}

function literalOf(node: any): VersionLiteral {
  return { value: node.value, start: node.range[0] + 1, end: node.range[1] - 1 };
}

/** Splits a table path into dependency section, target and the keys below it. */
function locateSection(path: string[]) {
  let i = 0;
  let target: string | undefined;
  let inWorkspace = false;
  if (path[0] === 'workspace' && path[1] === 'dependencies') {
    return { section: 'dependencies' as const, inWorkspace: true, target, rest: path.slice(2) };
  }
  if (path[0] === 'target' && path.length >= 3) {
    target = path[1];
    i = 2;
  }
  const section = SECTIONS[path[i] ?? ''];
  if (!section) return undefined;
  return { section, inWorkspace, target, rest: path.slice(i + 1) };
}
