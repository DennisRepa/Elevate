import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { locateDeclarations } from '../src/adapters/gradle/gradle-locator.js';
import type { LocateRequest, LocateResult, LocatedDeclaration } from '../src/adapters/gradle/gradle-locator.js';
import { applyGradleEdits } from '../src/adapters/gradle/gradle-text.js';
import { buildDoc, projectDoc } from './gradle-fake.js';
import { makeTree } from './helpers.js';

export const read = (file: string): string | undefined => (existsSync(file) ? readFileSync(file, 'utf8') : undefined);

export interface Options {
  group?: string;
  name?: string;
  version?: string;
  isPlugin?: boolean;
  viaScripts?: boolean;
  viaCatalog?: boolean;
  /** The build script of `:app`; `build.gradle` unless a scenario names another file. */
  script?: string;
  project?: string;
}

/** `settings.gradle` includes `app`; Gradle describes `:` and `:app`. */
export function locate(files: Record<string, string>, options: Options = {}): { root: string; result: LocateResult } {
  const script = options.script ?? 'build.gradle';
  const root = makeTree({ 'settings.gradle': "include 'app'", ...files });
  const rootScript = ['build.gradle', 'build.gradle.kts'].find((f) => existsSync(join(root, f)));
  const projects = [
    projectDoc(':', root, { buildFile: rootScript ? join(root, rootScript) : null }),
    projectDoc(':app', join(root, 'app'), { buildFile: join(root, 'app', script) }),
  ];
  const build = buildDoc('mono', root, projects).build;
  const request: LocateRequest = {
    rootDir: root,
    build,
    project: projects.find((p) => p.path === (options.project ?? ':app'))!,
    projects,
    group: options.group ?? 'org.example',
    name: options.name ?? 'lib',
    version: options.version ?? '1.0',
    isPlugin: options.isPlugin ?? false,
    viaScripts: options.viaScripts ?? !options.viaCatalog,
    viaCatalog: options.viaCatalog ?? false,
    read,
  };
  return { root, result: locateDeclarations(request) };
}

export function declarationsOf(result: LocateResult): LocatedDeclaration[] {
  if (!result.ok) throw new Error(`not located: ${result.detail}`);
  return result.declarations;
}

/** Applies the new version to every declaration, as the updater does, and returns the new text of each file. */
export function applyTo(declarations: LocatedDeclaration[], to = '1.1', from = '1.0'): Map<string, string> {
  const files = new Map<string, LocatedDeclaration[]>();
  for (const d of declarations) files.set(d.file, [...(files.get(d.file) ?? []), d]);
  const out = new Map<string, string>();
  for (const [file, list] of files) {
    out.set(
      file,
      applyGradleEdits(
        readFileSync(file, 'utf8'),
        list.map((d) => ({ ...d.range, expected: from, replacement: to })),
      ),
    );
  }
  return out;
}

export const failure = (result: LocateResult): string => {
  if (result.ok) throw new Error('expected a failure');
  return result.detail;
};
