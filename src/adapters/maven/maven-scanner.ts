import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import semver from 'semver';
import type { DependencyReaderPort, RegistryPort } from '../../domain/ports.js';
import type { ProjectModule, UpdateCandidate, ReleaseChannel } from '../../domain/models.js';
import { isPreReleaseVersion, extractPreReleaseTag } from './maven-registry.js';

const DIFF_ORDER: Record<string, number> = { major: 0, minor: 1, patch: 2 };
const CONCURRENCY = 6;

async function pooled<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: Promise<R>[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);

    if (concurrency <= items.length) {
      const slot: Promise<void> = p
        .then(() => void executing.splice(executing.indexOf(slot), 1))
        .catch(() => void executing.splice(executing.indexOf(slot), 1));
      executing.push(slot);
      if (executing.length >= concurrency) await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

/** Bereinigt Java-Versionen (z. B. "5.10.2", "1.71.0.Final" -> "5.10.2") für semver */
function cleanJavaVersion(v: string): string | null {
  const match = v.match(/^v?(\d+\.\d+(?:\.\d+)?)/);
  if (!match) return null;
  return semver.coerce(match[1])?.version ?? null;
}

interface RawMavenDep {
  group: string;
  artifact: string;
  rawVersion: string;
  scope: 'prod' | 'test';
}

export class MavenDependencyAdapter implements DependencyReaderPort {
  constructor(private readonly registry: RegistryPort) {}

  async scan(
    module: ProjectModule,
    excludedScopes: string[],
    internalIds: Set<string>,
    channel: ReleaseChannel = 'stable',
  ): Promise<UpdateCandidate[]> {
    const pomPath = join(module.path, 'pom.xml');
    let xml = '';
    try {
      xml = readFileSync(pomPath, 'utf8');
    } catch {
      return [];
    }

    // 1. Properties extrahieren
    const properties = new Map<string, string>();
    const propBlockMatch = xml.match(/<properties>([\s\S]*?)<\/properties>/);
    if (propBlockMatch?.[1]) {
      const propMatches = propBlockMatch[1].matchAll(/<([a-zA-Z0-9_.-]+)>([^<]+)<\/\1>/g);
      for (const m of propMatches) {
        properties.set(m[1]!.trim(), m[2]!.trim());
      }
    }

    // 2. Dependencies extrahieren (mit Deduplizierung nach identifier)
    const rawDeps: RawMavenDep[] = [];
    const seenCoordinates = new Set<string>();
    const depBlockMatches = xml.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g);

    for (const match of depBlockMatches) {
      const block = match[1]!;
      const groupMatch = block.match(/<groupId>([^<]+)<\/groupId>/);
      const artifactMatch = block.match(/<artifactId>([^<]+)<\/artifactId>/);
      const versionMatch = block.match(/<version>([^<]+)<\/version>/);
      const scopeMatch = block.match(/<scope>([^<]+)<\/scope>/);

      if (!groupMatch?.[1] || !artifactMatch?.[1]) continue;

      const group = groupMatch[1].trim();
      const artifact = artifactMatch[1].trim();
      const identifier = `${group}:${artifact}`;

      if (seenCoordinates.has(identifier)) continue;
      seenCoordinates.add(identifier);
      let rawVersion = versionMatch?.[1]?.trim() || '';

      // Property auflösen falls vorhanden: ${property.name}
      if (rawVersion.startsWith('${') && rawVersion.endsWith('}')) {
        const propKey = rawVersion.slice(2, -1);
        rawVersion = properties.get(propKey) || rawVersion;
      }

      if (!rawVersion || rawVersion.startsWith('${')) {
        continue; // Version von Parent/BOM gesteuert oder unaufgelöst
      }

      const scope = scopeMatch?.[1]?.trim() === 'test' ? 'test' : 'prod';

      // Internal modules or configured scopes filter
      const isInternal =
        internalIds.has(identifier) ||
        internalIds.has(artifact) ||
        excludedScopes.some((s) => group.startsWith(s.replace(/^@/, '')));

      if (isInternal) continue;

      rawDeps.push({ group, artifact, rawVersion, scope });
    }

    // 3. Neueste Versionen abfragen (unter Berücksichtigung des Release-Channels)
    const candidates: UpdateCandidate[] = [];

    await pooled(rawDeps, CONCURRENCY, async (dep) => {
      const latest = await this.registry.getLatestVersion(
        {
          identifier: `${dep.group}:${dep.artifact}`,
          group: dep.group,
          artifact: dep.artifact,
          ecosystem: 'maven',
        },
        channel,
      );

      if (!latest) return;

      const currentClean = cleanJavaVersion(dep.rawVersion);
      const latestClean = cleanJavaVersion(latest);

      if (!currentClean || !latestClean) return;

      if (semver.gt(latestClean, currentClean)) {
        const diff = (semver.diff(currentClean, latestClean) as 'patch' | 'minor' | 'major') || 'minor';
        const isPre = isPreReleaseVersion(latest);
        const preTag = isPre ? extractPreReleaseTag(latest) : undefined;

        candidates.push({
          coordinate: {
            identifier: `${dep.group}:${dep.artifact}`,
            group: dep.group,
            artifact: dep.artifact,
            ecosystem: 'maven',
          },
          currentRange: dep.rawVersion,
          currentClean,
          latest,
          newRange: latest,
          diff,
          scope: dep.scope,
          selected: diff !== 'major',
          isPreRelease: isPre,
          preReleaseTag: preTag,
        });
      }
    });

    candidates.sort((a, b) => (DIFF_ORDER[a.diff] ?? 3) - (DIFF_ORDER[b.diff] ?? 3));
    return candidates;
  }
}
