/**
 * Elevate — Maven-based dependency resolution.
 *
 * Two questions are answered by Maven itself instead of by parsing POMs:
 *
 * 1. Which version of each dependency applies? — `help:effective-pom` resolves
 *    parents, imported BOMs, properties and dependency management.
 * 2. Which newer versions exist? — the versions-maven-plugin queries the
 *    repositories exactly as the build does: mirrors, private repositories
 *    and credentials from settings.xml all apply.
 *
 * The plugin report runs against a generated probe POM rather than the real
 * project: the probe lists only the artifacts of interest, so inherited
 * management sections (often hundreds of BOM entries) are not queried, and the
 * report's generated site lands in Elevate's scratch directory instead of the
 * project's build output. The scratch directory lives below the module's
 * `target/` so the project's `.mvn/` configuration (maven.config, extensions)
 * still applies.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { childText, children, childAt, escapeXml, parseXml, serializeXml, child } from '../shared/xml.js';
import type { XmlElement } from '../shared/xml.js';
import { MavenCommandError, mavenErrors, relativeToCwd, runMaven } from './maven-command.js';

/** Versions of the two Maven plugins Elevate runs. */
export interface MavenPluginVersions {
  /** maven-help-plugin: reads the effective POM. */
  help: string;
  /** versions-maven-plugin: looks up newer versions. */
  versions: string;
}

/** Pinned plugin versions for reproducible results; replaceable per repository. */
export const DEFAULT_MAVEN_PLUGINS: MavenPluginVersions = { help: '3.5.2', versions: '2.22.0' };

const HELP_PLUGIN_ID = 'org.apache.maven.plugins:maven-help-plugin';
const VERSIONS_PLUGIN_ID = 'org.codehaus.mojo:versions-maven-plugin';

/** What Maven prints when it cannot download an artifact (matched case-insensitively). */
const DOWNLOAD_FAILURES = [
  'could not be resolved',
  'could not find artifact',
  'failed to read artifact descriptor',
  'could not transfer artifact',
];

/** Thrown when Maven could not download one of the plugins Elevate runs. */
export class MavenPluginUnavailableError extends MavenCommandError {
  constructor(
    plugin: { id: string; version: string; key: keyof MavenPluginVersions; purpose: string },
    output: string,
  ) {
    super(
      `Maven could not download ${plugin.id}:${plugin.version}, which Elevate uses to ${plugin.purpose}. ` +
        'Make this plugin available in the repository or mirror your Maven is configured with, ' +
        `or choose a version that is available there with "mavenPlugins": { "${plugin.key}": "<version>" } ` +
        `in elevate.config.json.\n${mavenErrors(output)}`,
      output,
    );
    this.name = 'MavenPluginUnavailableError';
  }
}

/** Whether a failed Maven run failed because it could not download the plugin. */
function isPluginUnavailable(output: string, pluginId: string): boolean {
  return output.split(/\r?\n/).some((line) => {
    const lower = line.toLowerCase();
    return line.includes(pluginId) && DOWNLOAD_FAILURES.some((phrase) => lower.includes(phrase));
  });
}

const MAVEN_TIMEOUT_MS = 5 * 60_000;

export interface EffectiveDependency {
  groupId: string;
  artifactId: string;
  version: string;
  scope: string;
  type: string;
  classifier?: string;
}

export interface EffectiveModel {
  dependencies: EffectiveDependency[];
  managedDependencies: EffectiveDependency[];
  repositories?: XmlElement;
  pluginRepositories?: XmlElement;
}

/** An artifact whose newer versions should be looked up. */
export interface ProbeArtifact {
  groupId: string;
  artifactId: string;
  version: string;
  type?: string;
  classifier?: string;
}

export interface VersionReport {
  /** Newer versions per `groupId:artifactId`, in ascending order. */
  newerVersions: Map<string, string[]>;
  /** Artifacts whose metadata could not be downloaded from some repository. */
  failedLookups: Set<string>;
}

/**
 * A scratch directory below the module's `target/`, unique per scan so
 * concurrent scans never share files. `dispose()` removes it again, together
 * with `target/` if the scan created that and left it empty.
 */
export class ScratchDirectory {
  readonly path: string;
  private readonly target: string;
  private readonly createdTarget: boolean;

  constructor(moduleDir: string) {
    this.target = join(moduleDir, 'target');
    this.createdTarget = !existsSync(this.target);
    this.path = join(this.target, `.elevate-${randomUUID().slice(0, 8)}`);
    mkdirSync(this.path, { recursive: true });
  }

  dispose(): void {
    rmSync(this.path, { recursive: true, force: true });
    try {
      if (this.createdTarget && readdirSync(this.target).length === 0) rmSync(this.target, { recursive: true });
    } catch {
      // Another process may be using target/ concurrently; leaving it is harmless.
    }
  }
}

/**
 * Runs `help:effective-pom` once and returns the model of every project it
 * covers, keyed by `groupId:artifactId`. With `recursive` the whole reactor of
 * an aggregator POM is resolved in a single Maven run; otherwise only the
 * given project (`-N`).
 */
export async function readEffectivePoms(
  pomFile: string,
  moduleDir: string,
  rootDir: string,
  scratch: ScratchDirectory,
  plugins: MavenPluginVersions,
  recursive = false,
): Promise<Map<string, EffectiveModel>> {
  const output = join(scratch.path, 'effective-pom.xml');
  // The files are named relative to the working directory (`moduleDir`), so the
  // directory the project lives in never appears on the command line.
  const args = [
    '-f',
    relativeToCwd(moduleDir, pomFile),
    `${HELP_PLUGIN_ID}:${plugins.help}:effective-pom`,
    `-Doutput=${relativeToCwd(moduleDir, output)}`,
  ];
  const result = await runMaven(recursive ? args : ['-N', ...args], {
    cwd: moduleDir,
    rootDir,
    timeoutMs: MAVEN_TIMEOUT_MS,
  });

  if (result.exitCode !== 0 || !existsSync(output)) {
    const text = `${result.stdout}\n${result.stderr}`;
    if (isPluginUnavailable(text, HELP_PLUGIN_ID)) {
      throw new MavenPluginUnavailableError(
        { id: HELP_PLUGIN_ID, version: plugins.help, key: 'help', purpose: 'read the effective POM' },
        text,
      );
    }
    throw new MavenCommandError(`Maven could not build the effective POM:\n${mavenErrors(text)}`, text);
  }
  return parseEffectivePoms(readFileSync(output, 'utf8'));
}

/** Parses `help:effective-pom` output: one `<project>` or a reactor's `<projects>`. */
export function parseEffectivePoms(source: string): Map<string, EffectiveModel> {
  const root = parseXml(source);
  const projects = root.name === 'projects' ? children(root, 'project') : [root];
  const models = new Map<string, EffectiveModel>();
  for (const project of projects) {
    models.set(`${childText(project, 'groupId')}:${childText(project, 'artifactId')}`, toEffectiveModel(project));
  }
  return models;
}

/** Parses the output of `help:effective-pom` for a single project. */
export function parseEffectivePom(source: string): EffectiveModel {
  let project = parseXml(source);
  if (project.name === 'projects') project = child(project, 'project') ?? project;
  return toEffectiveModel(project);
}

/** Combines the repository declarations of several models; the first declaration per id wins. */
export function mergeRepositories(models: readonly EffectiveModel[]): EffectiveModel {
  const merge = (name: string, pick: (m: EffectiveModel) => XmlElement | undefined): XmlElement | undefined => {
    const byId = new Map<string, XmlElement>();
    for (const element of models.map(pick)) {
      for (const repository of element?.children ?? []) {
        const id = childText(repository, 'id') ?? childText(repository, 'url') ?? '';
        if (!byId.has(id)) byId.set(id, repository);
      }
    }
    return byId.size > 0 ? { name, attributes: {}, children: [...byId.values()], text: '' } : undefined;
  };
  return {
    dependencies: [],
    managedDependencies: [],
    repositories: merge('repositories', (m) => m.repositories),
    pluginRepositories: merge('pluginRepositories', (m) => m.pluginRepositories),
  };
}

function toEffectiveModel(project: XmlElement): EffectiveModel {
  return {
    dependencies: readEffectiveDependencies(child(project, 'dependencies')),
    managedDependencies: readEffectiveDependencies(childAt(project, 'dependencyManagement', 'dependencies')),
    repositories: child(project, 'repositories'),
    pluginRepositories: child(project, 'pluginRepositories'),
  };
}

function readEffectiveDependencies(container: XmlElement | undefined): EffectiveDependency[] {
  return children(container, 'dependency').map((element) => ({
    groupId: childText(element, 'groupId') ?? '',
    artifactId: childText(element, 'artifactId') ?? '',
    version: childText(element, 'version') ?? '',
    scope: childText(element, 'scope') ?? 'compile',
    type: childText(element, 'type') ?? 'jar',
    classifier: childText(element, 'classifier'),
  }));
}

/** Builds a minimal POM that manages exactly the given artifacts. */
export function buildProbePom(artifacts: readonly ProbeArtifact[], model: EffectiveModel): string {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const artifact of artifacts) {
    const key = `${artifact.groupId}:${artifact.artifactId}:${artifact.type ?? 'jar'}:${artifact.classifier ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fields = [
      `<groupId>${escapeXml(artifact.groupId)}</groupId>`,
      `<artifactId>${escapeXml(artifact.artifactId)}</artifactId>`,
      `<version>${escapeXml(artifact.version)}</version>`,
      artifact.type && artifact.type !== 'jar' ? `<type>${escapeXml(artifact.type)}</type>` : '',
      artifact.classifier ? `<classifier>${escapeXml(artifact.classifier)}</classifier>` : '',
    ].filter(Boolean);
    entries.push(`      <dependency>${fields.join('')}</dependency>`);
  }

  const repositories = [model.repositories, model.pluginRepositories]
    .filter((element): element is XmlElement => element !== undefined)
    .map((element) => serializeXml(element, '  '))
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<project xmlns="http://maven.apache.org/POM/4.0.0">',
    '  <modelVersion>4.0.0</modelVersion>',
    '  <groupId>elevate.probe</groupId>',
    '  <artifactId>elevate-probe</artifactId>',
    '  <version>0</version>',
    '  <packaging>pom</packaging>',
    repositories,
    '  <dependencyManagement>',
    '    <dependencies>',
    ...entries,
    '    </dependencies>',
    '  </dependencyManagement>',
    '</project>',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** Looks up newer versions for the given artifacts with the versions-maven-plugin. */
export async function queryNewerVersions(
  artifacts: readonly ProbeArtifact[],
  model: EffectiveModel,
  moduleDir: string,
  rootDir: string,
  scratch: ScratchDirectory,
  plugins: MavenPluginVersions,
): Promise<VersionReport> {
  if (artifacts.length === 0) return { newerVersions: new Map(), failedLookups: new Set() };

  const probeDir = join(scratch.path, 'probe');
  mkdirSync(probeDir, { recursive: true });
  const probePom = join(probeDir, 'pom.xml');
  writeFileSync(probePom, buildProbePom(artifacts, model), 'utf8');

  const result = await runMaven(
    [
      '-N',
      '-f',
      relativeToCwd(moduleDir, probePom),
      `${VERSIONS_PLUGIN_ID}:${plugins.versions}:dependency-updates-report`,
      '-DdependencyUpdatesReportFormats=xml',
      '-DprocessDependencyManagementTransitive=false',
    ],
    { cwd: moduleDir, rootDir, timeoutMs: MAVEN_TIMEOUT_MS },
  );

  const log = `${result.stdout}\n${result.stderr}`;
  const reportFile = join(probeDir, 'target', 'dependency-updates-report.xml');
  if (result.exitCode !== 0 || !existsSync(reportFile)) {
    if (isPluginUnavailable(log, VERSIONS_PLUGIN_ID)) {
      throw new MavenPluginUnavailableError(
        { id: VERSIONS_PLUGIN_ID, version: plugins.versions, key: 'versions', purpose: 'look up newer versions' },
        log,
      );
    }
    throw new MavenCommandError(`Maven could not look up newer versions:\n${mavenErrors(log)}`, log);
  }

  return {
    newerVersions: parseUpdatesReport(readFileSync(reportFile, 'utf8')),
    failedLookups: parseFailedLookups(log),
  };
}

/** Collects the newer versions per artifact from the plugin's XML report. */
export function parseUpdatesReport(source: string): Map<string, string[]> {
  const report = parseXml(source);
  const sections = [
    ...children(child(report, 'dependencyManagements'), 'dependencyManagement'),
    ...children(child(report, 'dependencies'), 'dependency'),
  ];

  const result = new Map<string, string[]>();
  for (const entry of sections) {
    const key = `${childText(entry, 'groupId')}:${childText(entry, 'artifactId')}`;
    const versions = [
      ...collect(entry, 'subIncrementals', 'subIncremental'),
      ...collect(entry, 'incrementals', 'incremental'),
      ...collect(entry, 'minors', 'minor'),
      ...collect(entry, 'majors', 'major'),
    ];
    const known = result.get(key) ?? [];
    for (const version of versions) if (!known.includes(version)) known.push(version);
    result.set(key, known);
  }
  return result;
}

function collect(entry: XmlElement, container: string, item: string): string[] {
  return children(child(entry, container), item)
    .map((element) => element.text.trim())
    .filter(Boolean);
}

/**
 * The plugin downgrades repository errors to warnings and then reports the
 * artifact as up to date. Those warnings are the only trace of a failed
 * lookup, so they are surfaced instead of trusting the "no update" result.
 */
export function parseFailedLookups(log: string): Set<string> {
  const failed = new Set<string>();
  const pattern = /Could not (?:transfer|read) metadata ([^:\s/]+):([^:\s/]+)(?::[^\s/]+)?\/maven-metadata\.xml/g;
  for (const match of log.matchAll(pattern)) failed.add(`${match[1]}:${match[2]}`);
  return failed;
}
