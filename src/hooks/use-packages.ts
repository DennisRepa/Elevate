/**
 * 🪶 Elevate — usePackages hook
 *
 * Scans a module through the DependencyReaderPort of the active ecosystem
 * strategy and manages selection, filtering and tabs. Dependencies the scan
 * could not offer and scan errors are kept for display, so an empty list is
 * never mistaken for "everything is up to date".
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import semver from 'semver';
import type {
  UpdateCandidate,
  Tab,
  SelectionCounts,
  ProjectModule,
  ReleaseChannel,
  SkippedDependency,
  VersionDiff,
} from '../domain/models.js';
import type { EcosystemStrategy } from '../domain/ecosystem-strategy.js';
import type { ElevateConfig } from '../config.js';
import { cleanJavaVersion, diffVersions, extractPreReleaseTag, isPreReleaseVersion, rangePrefix } from '../domain/versions.js';
import { createScanContext, scanModule } from '../application/scan.js';

export function usePackages(
  strategy: EcosystemStrategy,
  module: ProjectModule,
  modules: readonly ProjectModule[],
  config: Pick<ElevateConfig, 'rootDir' | 'internalScopes'>,
  channel: ReleaseChannel = 'stable',
) {
  const [candidates, setCandidates] = useState<UpdateCandidate[]>([]);
  const [skipped, setSkipped] = useState<SkippedDependency[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [cursor, setCursor] = useState(0);
  // Only the latest scan may publish results; earlier ones may finish later.
  const scanGeneration = useRef(0);

  const scan = useCallback(async () => {
    const generation = ++scanGeneration.current;
    if (!module || module.id === 'empty') {
      setCandidates([]);
      setSkipped([]);
      return;
    }
    setLoading(true);
    setCursor(0);
    setCandidates([]);
    setSkipped([]);
    setError(undefined);

    const context = createScanContext(modules, config, channel);
    const result = await scanModule(strategy, module, context);
    if (generation !== scanGeneration.current) return;
    setCandidates(result.candidates);
    setSkipped(result.skipped);
    setError(result.error);
    setLoading(false);
  }, [strategy, module.path, module.id, modules, config.rootDir, config.internalScopes, channel]);

  useEffect(() => {
    if (module && module.id !== 'empty') {
      scan();
    }
  }, [module.path, module.id, strategy.ecosystem, channel, modules]);

  // Visible packages for the active tab.
  const visible = useMemo(() => {
    if (activeTab === 'prod') return candidates.filter((c) => c.scope === 'prod');
    if (activeTab === 'dev') return candidates.filter((c) => c.scope !== 'prod');
    return candidates;
  }, [candidates, activeTab]);

  const counts: SelectionCounts = useMemo(() => {
    const selected = candidates.filter((c) => c.selected);
    return {
      total: candidates.length,
      prodCount: candidates.filter((c) => c.scope === 'prod').length,
      devCount: candidates.filter((c) => c.scope !== 'prod').length,
      selectedCount: selected.length,
      patchCount: selected.filter((c) => c.diff === 'patch').length,
      minorCount: selected.filter((c) => c.diff === 'minor').length,
      majorCount: selected.filter((c) => c.diff === 'major').length,
    };
  }, [candidates]);

  const togglePackage = useCallback((identifier: string) => {
    setCandidates((prev) =>
      prev.map((c) => (c.coordinate.identifier === identifier ? { ...c, selected: !c.selected } : c)),
    );
  }, []);

  const toggleAllVisible = useCallback(() => {
    const allSelected = visible.every((c) => c.selected);
    const visibleIds = new Set(visible.map((c) => c.coordinate.identifier));
    setCandidates((prev) =>
      prev.map((c) => (visibleIds.has(c.coordinate.identifier) ? { ...c, selected: !allSelected } : c)),
    );
  }, [visible]);

  // Sets a manually picked target version for a dependency.
  const setCustomVersion = useCallback((identifier: string, chosenVersion: string) => {
    setCandidates((prev) =>
      prev.map((c) => {
        if (c.coordinate.identifier !== identifier) return c;

        const target = c.coordinate.ecosystem === 'maven' ? cleanJavaVersion(chosenVersion) : semver.valid(chosenVersion);
        let diff: VersionDiff = 'minor';
        if (c.currentClean && target && semver.valid(c.currentClean)) {
          diff = semver.eq(c.currentClean, target) ? 'patch' : diffVersions(c.currentClean, target);
        }

        const isPre = isPreReleaseVersion(chosenVersion);
        return {
          ...c,
          newRange: c.coordinate.ecosystem === 'npm' ? `${rangePrefix(c.currentRange)}${chosenVersion}` : chosenVersion,
          latest: chosenVersion,
          diff,
          selected: true,
          isPreRelease: isPre,
          preReleaseTag: isPre ? extractPreReleaseTag(chosenVersion) : undefined,
          isCustomVersion: true,
        };
      }),
    );
  }, []);

  const switchTab = useCallback((tab: Tab) => {
    setActiveTab(tab);
    setCursor(0);
  }, []);

  const cycleTab = useCallback(() => {
    setActiveTab((t) => (t === 'all' ? 'prod' : t === 'prod' ? 'dev' : 'all'));
    setCursor(0);
  }, []);

  return {
    packages: candidates,
    skipped,
    error,
    loading,
    visible,
    counts,
    activeTab,
    cursor,
    setCursor,
    scan,
    switchTab,
    cycleTab,
    togglePackage,
    toggleAllVisible,
    setCustomVersion,
  } as const;
}
