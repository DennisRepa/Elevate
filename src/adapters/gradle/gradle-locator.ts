/**
 * Elevate — where a Gradle dependency's version is written (specs/23).
 *
 * Gradle says what applies (the version after every script has run), not where
 * the version is written. The locator searches the files of the build for the
 * text that carries it and checks its find against Gradle's answer: a location
 * counts only if the text there is exactly the version Gradle reports. What
 * cannot be located with certainty is not guessed; it comes back as the reason
 * it is not offered. This is the pattern of Maven's locator, for files that are
 * programs instead of XML.
 *
 * Searched, in this order, for the dependencies of a module: string and map
 * notation in the module's own build script; when that script has no such
 * literal, the build scripts of the parent projects, nearest first; the
 * definition of a name used as the version (`gradle.properties`, `ext`,
 * variables); `gradle/libs.versions.toml` for a dependency from the catalog.
 * Not searched: `buildSrc`, included-build convention plugins, `apply from:`
 * scripts, init scripts and the user's `gradle.properties`.
 */

import { join, relative } from 'node:path';
import type { SkipReason, VersionDeclaration } from '../../domain/models.js';
import {
  CATALOG_FILE,
  CATALOG_NAME,
  catalogVersionKeys,
  catalogVersionRange,
  catalogVersionText,
  parseCatalog,
} from './gradle-catalog.js';
import type { GradleBuildDocument, GradleProjectDocument } from './gradle-probe.js';
import { dslOf, findBlocks, scanSource } from './gradle-text.js';
import type { GradleDsl, ScannedSource, StringLiteral } from './gradle-text.js';

// ---- what Gradle reports, and what it means -------------------------------------

/** The parts of a reported dependency that decide whether it is offered. */
export interface ReportedVersion {
  group: string | null;
  name: string;
  version: string | null;
  strictly: string | null;
  preferred: string | null;
  rejected: readonly string[];
}

export type Assessment =
  | { action: 'ignore' }
  | { action: 'skip'; reason: SkipReason; detail?: string }
  | { action: 'locate' };

const DYNAMIC_VERSION = /^\+$|\+$|^latest\.|^[[(\]]/;

/**
 * Decides what to do with a reported external module: nothing to offer when it
 * has no version (a platform, a constraint or a plugin manages it), listed when
 * it has no group, when the version is a selector, or when it carries
 * `strictly`, `reject` or `prefer`.
 */
export function assessDependency(dependency: ReportedVersion): Assessment {
  const version = dependency.version;
  if (version === null || version.trim() === '') return { action: 'ignore' };
  if (!dependency.group) return { action: 'skip', reason: 'invalid-name', detail: 'no group' };
  if (dependency.strictly) {
    return { action: 'skip', reason: 'version-constraint', detail: `strictly '${dependency.strictly}'` };
  }
  if (dependency.rejected.length > 0) {
    return { action: 'skip', reason: 'version-constraint', detail: `reject '${dependency.rejected.join("', '")}'` };
  }
  if (dependency.preferred) {
    return { action: 'skip', reason: 'version-constraint', detail: `prefer '${dependency.preferred}'` };
  }
  if (DYNAMIC_VERSION.test(version)) {
    return { action: 'skip', reason: 'version-constraint', detail: `dynamic version '${version}'` };
  }
  return { action: 'locate' };
}

/** A configuration is a test configuration when one of the words of its camelCase name is "test". */
export function isTestConfiguration(configuration: string): boolean {
  return configuration
    .split(/(?=[A-Z])/)
    .some((word) => word.toLowerCase() === 'test');
}

// ---- locating -----------------------------------------------------------------------

/** A place a version is written, with the text offsets an update replaces. */
export interface LocatedDeclaration extends VersionDeclaration {
  range: { start: number; end: number; before: string; after: string; text: string };
}

export interface LocateRequest {
  /** The repository root, for the paths shown to the user. */
  rootDir: string;
  /** The build the project belongs to: its directory holds `gradle.properties`, the settings file and the catalog. */
  build: GradleBuildDocument['build'];
  project: GradleProjectDocument;
  /** Every project of the build, to find the parent projects. */
  projects: readonly GradleProjectDocument[];
  /** The coordinate and the version Gradle reports. For a plugin `group` is the plugin id. */
  group: string;
  name: string;
  version: string;
  isPlugin: boolean;
  /** Gradle reports a declaration of the coordinate that is not from the catalog (or a plugin). */
  viaScripts: boolean;
  /** Gradle reports a declaration of the coordinate that comes from the catalog. */
  viaCatalog: boolean;
  /** Reads a file as text (byte order mark included); `undefined` when it does not exist. */
  read(file: string): string | undefined;
}

export type LocateResult =
  | { ok: true; declarations: LocatedDeclaration[] }
  | { ok: false; detail: string };

/** A location before the characters around it are recorded. */
type Raw = VersionDeclaration & { range: { start: number; end: number } };
type RawResult = { ok: true; declarations: Raw[] } | { ok: false; detail: string };

const fail = (detail: string): { ok: false; detail: string } => ({ ok: false, detail });

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Path of `file` relative to the repository root, with forward slashes. */
function displayPath(rootDir: string, file: string): string {
  return relative(rootDir, file).replace(/\\/g, '/');
}

const SETTINGS_FILES = ['settings.gradle', 'settings.gradle.kts'];

interface Script {
  file: string;
  source: string;
  dsl: GradleDsl;
  scanned: ScannedSource;
}

class Locator {
  private readonly scripts: Script[] = [];
  private readonly settings: Script[] = [];

  constructor(private readonly request: LocateRequest) {
    const { project, projects, build } = request;
    const own = project.buildFile ?? join(project.dir, 'build.gradle');
    this.addScript(this.scripts, own);
    // The parent projects of the same build, nearest first.
    const segments = project.path.split(':').filter(Boolean);
    for (let n = segments.length - 1; n >= 0; n--) {
      const path = n === 0 ? ':' : `:${segments.slice(0, n).join(':')}`;
      const parent = projects.find((candidate) => candidate.path === path);
      if (parent?.buildFile) this.addScript(this.scripts, parent.buildFile);
    }
    for (const name of SETTINGS_FILES) this.addScript(this.settings, join(build.dir, name));
  }

  private addScript(into: Script[], file: string): void {
    const source = this.request.read(file);
    if (source === undefined) return;
    const dsl = dslOf(file);
    into.push({ file, source, dsl, scanned: scanSource(source, dsl) });
  }

  private show(file: string): string {
    return displayPath(this.request.rootDir, file);
  }

  /** `app/build.gradle`: the build script of the module, named in the messages. */
  private get ownScript(): string {
    return this.show(this.request.project.buildFile ?? join(this.request.project.dir, 'build.gradle'));
  }

  locate(): LocateResult {
    const results: RawResult[] = [];
    if (this.request.viaScripts) results.push(this.request.isPlugin ? this.locatePlugin() : this.locateInScripts());
    if (this.request.viaCatalog) results.push(this.locateInCatalog());
    if (results.length === 0) return fail(this.notFound());

    // Every part must be found: a coordinate that is only partly changed would resolve to the old version.
    const parts: Raw[] = [];
    for (const result of results) {
      if (!result.ok) return result;
      parts.push(...result.declarations);
    }

    // One place is listed once, whichever way it was found.
    const seen = new Set<string>();
    const unique = parts.filter((d) => {
      const key = `${d.file}:${d.range.start}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // A constraint is a declaration of the coordinate too, but never the main one.
    unique.sort((a, b) => Number(a.kind === 'dependency-management') - Number(b.kind === 'dependency-management'));
    return { ok: true, declarations: unique.map((d) => this.withContext(d)) };
  }

  /** Records the characters around the version text, so an update notices that `1.0` became `1.0.1`. */
  private withContext(declaration: Raw): LocatedDeclaration {
    const source = this.request.read(declaration.file) ?? '';
    const { start, end } = declaration.range;
    return {
      ...declaration,
      range: {
        start,
        end,
        before: source.slice(Math.max(0, start - 1), start),
        after: source.slice(end, end + 1),
        text: source.slice(start, end),
      },
    };
  }

  private notFound(): string {
    const { group, name, version, isPlugin } = this.request;
    const what = isPlugin ? `${group}:${version}` : `${group}:${name}:${version}`;
    return `no declaration of ${what} found in ${this.ownScript} or in the build scripts of its parent projects`;
  }

  // ---- dependencies in build scripts ------------------------------------------------

  private locateInScripts(): RawResult {
    for (const script of this.scripts) {
      const found = this.literalsIn(script);
      if (found.length === 0) continue;
      const declarations: Raw[] = [];
      for (const hit of found) {
        if (hit.type === 'literal') {
          declarations.push(hit.declaration);
        } else if (hit.type === 'name') {
          const resolved = this.resolveName(hit.name);
          if (!resolved.ok) return resolved;
          declarations.push(...resolved.declarations);
        } else {
          const resolved = this.resolveCatalogAccessor(hit.accessor);
          if (!resolved.ok) return resolved;
          declarations.push(...resolved.declarations);
        }
      }
      return { ok: true, declarations };
    }
    return fail(this.notFound());
  }

  private literalsIn(script: Script): Hit[] {
    const { group, name, version } = this.request;
    const hits: Hit[] = [];
    const constraints = findBlocks(script.scanned.masked, 'constraints');
    const kindAt = (offset: number): 'dependency' | 'dependency-management' =>
      constraints.some((block) => offset > block.start && offset < block.end) ? 'dependency-management' : 'dependency';
    const literal = (start: number, end: number): Hit => ({
      type: 'literal',
      declaration: {
        file: script.file,
        kind: kindAt(start),
        displayPath: this.show(script.file),
        range: { start, end },
      },
    });

    // String notation: "group:name:version[:classifier][@extension]".
    for (const lit of script.scanned.literals) {
      const parts = lit.value.split(':');
      if (parts.length < 3 || parts[0] !== group || parts[1] !== name) continue;
      let third = parts[2]!;
      if (parts.length === 3) third = third.replace(/@[^@]*$/, '');
      const start = lit.start + parts[0].length + 1 + parts[1].length + 1;
      const end = start + third.length;
      if (third === version) {
        hits.push(literal(start, end));
        continue;
      }
      if (!lit.quote.startsWith('"')) continue;
      const reference = /^\$(\w+)$|^\$\{(\w+)\}$/.exec(third);
      if (reference) {
        hits.push({ type: 'name', name: (reference[1] ?? reference[2])! });
        continue;
      }
      const accessor = /^\$\{libs\.versions\.([\w.-]+)\.get\(\)\}$/.exec(third);
      if (accessor) hits.push({ type: 'accessor', accessor: accessor[1]! });
    }

    // Map notation: group, name and version of one call, in any order.
    const masked = script.scanned.masked;
    const anchor = new RegExp(`\\bname\\s*[:=]\\s*(['"])${escapeRegExp(name)}\\1`, 'g');
    for (const match of masked.matchAll(anchor)) {
      const region = enclosingCall(masked, match.index!);
      const text = masked.slice(region.start, region.end);
      const groupKey = new RegExp(`\\bgroup\\s*[:=]\\s*(['"])${escapeRegExp(group)}\\1`);
      if (!groupKey.test(text)) continue;
      const versionKey = /\bversion\s*[:=]\s*(?:(['"])(.*?)\1|([A-Za-z_]\w*))/d.exec(text);
      if (!versionKey) continue;
      if (versionKey[3] !== undefined) {
        hits.push({ type: 'name', name: versionKey[3] });
      } else if (versionKey[2] === version) {
        const start = region.start + versionKey.indices![2]![0];
        hits.push(literal(start, start + version.length));
      }
    }

    return dedupeHits(hits);
  }

  // ---- names ---------------------------------------------------------------------------

  /** The definition of a name used as the version: `gradle.properties` first, then the scripts. */
  private resolveName(name: string): RawResult {
    const { project, build, rootDir, version } = this.request;
    const pattern = new RegExp(`^([ \\t]*${escapeRegExp(name)}[ \\t]*[=:][ \\t]*)(.*?)[ \\t]*$`, 'gm');

    const propertyFiles = [...new Set([join(project.dir, 'gradle.properties'), join(build.dir, 'gradle.properties')])];
    for (const file of propertyFiles) {
      const source = this.request.read(file);
      if (source === undefined) continue;
      const matches = [...source.matchAll(pattern)];
      if (matches.length === 0) continue;
      const shown = displayPath(rootDir, file);
      if (matches.length > 1) return fail(`'${name}' is defined twice in ${shown}`);
      const match = matches[0]!;
      if (match[2] !== version) {
        return fail(`'${name}' is ${match[2]} in ${shown} but Gradle uses ${version} (command line or user-level override?)`);
      }
      const start = match.index! + match[1]!.length;
      return {
        ok: true,
        declarations: [
          { file, kind: 'property', propertyName: name, displayPath: shown, range: { start, end: start + version.length } },
        ],
      };
    }

    for (const script of this.scripts) {
      const definitions = definitionsOf(script, name);
      if (definitions.length === 0) continue;
      const shown = this.show(script.file);
      if (definitions.length > 1) return fail(`'${name}' is defined twice in ${shown}`);
      const definition = definitions[0]!;
      if (definition.value !== version) {
        return fail(`'${name}' is ${definition.value} in ${shown} but Gradle uses ${version} (command line or user-level override?)`);
      }
      return {
        ok: true,
        declarations: [
          {
            file: script.file,
            kind: 'property',
            propertyName: name,
            displayPath: shown,
            range: { start: definition.start, end: definition.end },
          },
        ],
      };
    }

    return fail(
      `no definition of '${name}' in gradle.properties or in the build scripts of '${project.path}' and its parent projects`,
    );
  }

  // ---- plugins ---------------------------------------------------------------------------

  private locatePlugin(): RawResult {
    const { group: id, version } = this.request;
    const idPattern = escapeRegExp(id);
    const shorthand = /^org\.jetbrains\.kotlin\.(.+)$/.exec(id)?.[1];

    const forms = [
      new RegExp(`\\bid\\s*\\(?\\s*(['"])${idPattern}\\1\\s*\\)?\\s*version\\s*\\(?\\s*(['"])(.*?)\\2`, 'dg'),
    ];
    if (shorthand) {
      forms.push(
        new RegExp(`\\bkotlin\\s*\\(\\s*(['"])${escapeRegExp(shorthand)}\\1\\s*\\)\\s*version\\s*\\(?\\s*(['"])(.*?)\\2`, 'dg'),
      );
    }

    // The scripts first, the settings file (`pluginManagement { plugins { } }`) after them.
    for (const group of [this.scripts, this.settings]) {
      for (const script of group) {
        const declarations: Raw[] = [];
        for (const form of forms) {
          for (const match of script.scanned.masked.matchAll(form)) {
            const [start, end] = match.indices![3]!;
            if (script.source.slice(start, end) !== version) continue;
            declarations.push({
              file: script.file,
              kind: 'plugin',
              displayPath: this.show(script.file),
              range: { start, end },
            });
          }
        }
        if (declarations.length > 0) return { ok: true, declarations };
      }
    }

    // `alias(libs.plugins.x)`: the version is in the catalog.
    const fromCatalog = this.locateInCatalog();
    if (fromCatalog.ok) return fromCatalog;
    return fail(this.notFound());
  }

  // ---- the catalog -----------------------------------------------------------------------

  private get catalogFile(): string {
    return join(this.request.build.dir, CATALOG_FILE);
  }

  private locateInCatalog(): RawResult {
    const { group, name, version, isPlugin, rootDir } = this.request;
    const shown = displayPath(rootDir, this.catalogFile);
    const noEntry = (): RawResult =>
      fail(
        isPlugin
          ? `no entry for plugin ${group}:${version} in ${CATALOG_FILE} (other catalogs are not read)`
          : `no entry for ${group}:${name}:${version} in ${CATALOG_FILE} (other catalogs are not read)`,
      );

    const source = this.request.read(this.catalogFile);
    const catalog = source === undefined ? undefined : parseCatalog(source);
    if (source === undefined || !catalog) return noEntry();

    const matching = catalog.entries.filter((entry) =>
      isPlugin
        ? entry.section === 'plugins' && entry.id === group && catalogVersionText(entry.version) === version
        : entry.section === 'libraries' &&
          entry.group === group &&
          entry.name === name &&
          catalogVersionText(entry.version) === version,
    );
    if (matching.length === 0) return noEntry();
    if (matching.length > 1) {
      return fail(
        `${matching.length} entries of ${CATALOG_FILE} declare ${group}:${name}:${version}: ${matching.map((e) => e.key).join(', ')}`,
      );
    }

    const entry = matching[0]!;
    const range = catalogVersionRange(source, entry.versionEntry);
    if (!range || source.slice(range.start, range.end) !== version) {
      return fail(`cannot locate the version of ${entry.versionEntry} in ${CATALOG_FILE}`);
    }
    return {
      ok: true,
      declarations: [
        {
          file: this.catalogFile,
          kind: 'catalog',
          catalogName: CATALOG_NAME,
          entry: entry.versionEntry,
          displayPath: shown,
          range,
        },
      ],
    };
  }

  /** `"g:a:${libs.versions.lib.get()}"`: the version entry the accessor names. */
  private resolveCatalogAccessor(accessor: string): RawResult {
    const { version, rootDir } = this.request;
    const source = this.request.read(this.catalogFile);
    const key = source === undefined ? undefined : catalogVersionKeys(source).find((k) => k.replace(/[-_]/g, '.') === accessor);
    const range = key === undefined || source === undefined ? undefined : catalogVersionRange(source, `versions.${key}`);
    if (!range || source === undefined || source.slice(range.start, range.end) !== version) {
      return fail(`no entry for ${accessor} with the version ${version} in ${CATALOG_FILE} (other catalogs are not read)`);
    }
    return {
      ok: true,
      declarations: [
        {
          file: this.catalogFile,
          kind: 'catalog',
          catalogName: CATALOG_NAME,
          entry: `versions.${key}`,
          displayPath: displayPath(rootDir, this.catalogFile),
          range,
        },
      ],
    };
  }
}

type Hit =
  | { type: 'literal'; declaration: Raw }
  | { type: 'name'; name: string }
  | { type: 'accessor'; accessor: string };

function dedupeHits(hits: Hit[]): Hit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key =
      hit.type === 'literal'
        ? `l:${hit.declaration.file}:${hit.declaration.range.start}`
        : hit.type === 'name'
          ? `n:${hit.name}`
          : `a:${hit.accessor}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The part of the source inside the parentheses around `index`, or its line when there are none. */
function enclosingCall(masked: string, index: number): { start: number; end: number } {
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    const ch = masked[i];
    if (ch === '\n') break;
    if (ch === ')') depth++;
    else if (ch === '(') {
      if (depth === 0) {
        let close = 1;
        for (let j = i + 1; j < masked.length; j++) {
          if (masked[j] === '(') close++;
          else if (masked[j] === ')' && --close === 0) return { start: i + 1, end: j };
        }
        break;
      }
      depth--;
    }
  }
  const start = masked.lastIndexOf('\n', index) + 1;
  let end = masked.indexOf('\n', index);
  if (end === -1) end = masked.length;
  return { start, end };
}

interface Definition {
  value: string;
  start: number;
  end: number;
}

/** The plain string literals a script assigns to `name`: variables, `ext` values and `extra` entries. */
function definitionsOf(script: Script, name: string): Definition[] {
  const n = escapeRegExp(name);
  const { masked, literals } = script.scanned;
  const byOpening = new Map<number, StringLiteral>();
  for (const lit of literals) byOpening.set(lit.start - lit.quote.length, lit);

  const patterns: { regex: RegExp; within?: { start: number; end: number }[] }[] =
    script.dsl === 'groovy'
      ? [
          { regex: new RegExp(`(?<![\\w.])(?:def|String|final\\s+String|final\\s+def)\\s+${n}\\s*=\\s*(?=['"])`, 'g') },
          { regex: new RegExp(`(?<![\\w.])(?:project\\.)?ext\\.${n}\\s*=\\s*(?=['"])`, 'g') },
          { regex: new RegExp(`(?<![\\w.])${n}\\s*=\\s*(?=['"])`, 'g'), within: findBlocks(masked, 'ext') },
        ]
      : [
          { regex: new RegExp(`\\b(?:val|var)\\s+${n}(?:\\s*:\\s*String)?\\s*=\\s*(?=")`, 'g') },
          { regex: new RegExp(`\\bextra\\s*\\[\\s*"${n}"\\s*\\]\\s*=\\s*(?=")`, 'g') },
          { regex: new RegExp(`\\b(?:val|var)\\s+${n}\\s+by\\s+extra\\s*\\(\\s*(?=")`, 'g') },
        ];

  const found = new Map<number, Definition>();
  for (const { regex, within } of patterns) {
    for (const match of masked.matchAll(regex)) {
      const opening = match.index! + match[0].length;
      if (within && !within.some((block) => opening > block.start && opening < block.end)) continue;
      const lit = byOpening.get(opening);
      if (!lit) continue;
      found.set(lit.start, { value: lit.value, start: lit.start, end: lit.end });
    }
  }

  // A definition counts when the literal is the whole value: nothing but the end of the statement follows.
  return [...found.values()].filter((definition) => {
    const lit = literals.find((candidate) => candidate.start === definition.start)!;
    if (lit.quote.startsWith('"') && lit.value.includes('$')) return false;
    const after = masked.slice(lit.end + lit.quote.length);
    return /^[ \t]*(?:\r?\n|;|\}|\)|$)/.test(after);
  });
}

/** Finds where the version of a reported dependency is written. */
export function locateDeclarations(request: LocateRequest): LocateResult {
  return new Locator(request).locate();
}
