import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import semver from 'semver';
import type { DependencyReaderPort, RegistryPort } from '../../domain/ports.js';
import type { ProjectModule, UpdateCandidate, ReleaseChannel } from '../../domain/models.js';

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

function matchesExcludedScope(name: string, excludeScopes: string[]): boolean {
  return excludeScopes.some((scope) => {
    const normalized = scope.endsWith('/') ? scope : `${scope}/`;
    return name.startsWith(normalized);
  });
}

export class NpmDependencyAdapter implements DependencyReaderPort {
  constructor(private readonly registry: RegistryPort) {}

  async scan(
    module: ProjectModule,
    excludedScopes: string[],
    internalIds: Set<string>,
    channel: ReleaseChannel = 'stable',
  ): Promise<UpdateCandidate[]> {
    const pkgPath = join(module.path, 'package.json');
    let pkg: any;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    } catch {
      return [];
    }

    const allDeps: Record<string, string> = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };

    const entries = Object.entries(allDeps).filter(
      ([name]) => !internalIds.has(name) && !matchesExcludedScope(name, excludedScopes),
    );

    const candidates: UpdateCandidate[] = [];

    await pooled(entries, CONCURRENCY, async ([name, currentRange]) => {
      const latest = await this.registry.getLatestVersion(
        {
          identifier: name,
          artifact: name,
          ecosystem: 'npm',
        },
        channel,
      );
      if (!latest) return;

      const currentClean = semver.minVersion(currentRange)?.version;
      if (!currentClean || !semver.gt(latest, currentClean)) return;

      const diff = semver.diff(currentClean, latest) as 'patch' | 'minor' | 'major';
      const prefix = currentRange.startsWith('~')
        ? '~'
        : currentRange.startsWith('^')
          ? '^'
          : '';

      const prereleaseComponents = semver.prerelease(latest);
      const isPre = prereleaseComponents !== null;
      const preTag = isPre ? String(prereleaseComponents[0]).toUpperCase() : undefined;

      candidates.push({
        coordinate: {
          identifier: name,
          artifact: name,
          ecosystem: 'npm',
        },
        currentRange,
        currentClean,
        latest,
        newRange: `${prefix}${latest}`,
        diff,
        scope: pkg.devDependencies?.[name] ? 'dev' : 'prod',
        selected: diff !== 'major',
        isPreRelease: isPre,
        preReleaseTag: preTag,
      });
    });

    candidates.sort((a, b) => (DIFF_ORDER[a.diff] ?? 3) - (DIFF_ORDER[b.diff] ?? 3));
    return candidates;
  }
}
