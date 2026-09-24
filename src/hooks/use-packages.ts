/**
 * 🪶 Elevate — usePackages Hook (Domain-Driven)
 *
 * Scannt Abhängigkeiten eines Moduls über den DependencyReaderPort
 * der aktuellen Ökosystem-Strategie und verwaltet Auswahl, Filterung und Tabs.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import semver from 'semver';
import type {
  UpdateCandidate,
  Tab,
  SelectionCounts,
  ProjectModule,
  ReleaseChannel,
  VersionDiff,
} from '../domain/models.js';
import type { EcosystemStrategy } from '../domain/ecosystem-strategy.js';
import { isPreReleaseVersion, extractPreReleaseTag } from '../adapters/maven/maven-registry.js';

export function usePackages(
  strategy: EcosystemStrategy,
  module: ProjectModule,
  internalIds: Set<string>,
  excludeScopes: string[] = [],
  channel: ReleaseChannel = 'stable',
) {
  const [candidates, setCandidates] = useState<UpdateCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [cursor, setCursor] = useState(0);

  // Scan beim Modul- oder Strategiewechsel
  const scan = useCallback(async () => {
    if (!module || module.id === 'empty') {
      setCandidates([]);
      return;
    }
    setLoading(true);
    setCursor(0);
    setCandidates([]);

    try {
      const updates = await strategy.reader.scan(module, excludeScopes, internalIds, channel);
      setCandidates(updates);
    } catch {
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }, [strategy, module.path, module.id, internalIds, excludeScopes, channel]);

  useEffect(() => {
    if (module && module.id !== 'empty') {
      scan();
    }
  }, [module.path, module.id, strategy.ecosystem, channel]);

  // Sichtbare Pakete je nach Tab
  const visible = useMemo(() => {
    if (activeTab === 'prod') return candidates.filter((c) => c.scope === 'prod');
    if (activeTab === 'dev') return candidates.filter((c) => c.scope !== 'prod');
    return candidates;
  }, [candidates, activeTab]);

  // Zählerstände
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

  // Einzelnes Paket togglen
  const togglePackage = useCallback((identifier: string) => {
    setCandidates((prev) =>
      prev.map((c) =>
        c.coordinate.identifier === identifier ? { ...c, selected: !c.selected } : c,
      ),
    );
  }, []);

  // Alle sichtbaren togglen
  const toggleAllVisible = useCallback(() => {
    const allSelected = visible.every((c) => c.selected);
    const visibleIds = new Set(visible.map((c) => c.coordinate.identifier));
    setCandidates((prev) =>
      prev.map((c) =>
        visibleIds.has(c.coordinate.identifier) ? { ...c, selected: !allSelected } : c,
      ),
    );
  }, [visible]);

  // Benutzerdefinierte Version für eine Abhängigkeit setzen
  const setCustomVersion = useCallback((identifier: string, chosenVersion: string) => {
    setCandidates((prev) =>
      prev.map((c) => {
        if (c.coordinate.identifier !== identifier) return c;

        const prefix = c.currentRange.startsWith('~')
          ? '~'
          : c.currentRange.startsWith('^')
            ? '^'
            : '';

        let diff: VersionDiff = 'minor';
        const cleanChosen = semver.valid(chosenVersion);
        if (c.currentClean && cleanChosen) {
          const semDiff = semver.diff(c.currentClean, chosenVersion);
          if (semDiff === 'major' || semDiff === 'minor' || semDiff === 'patch') {
            diff = semDiff;
          }
        }

        const isPre = isPreReleaseVersion(chosenVersion);
        const preTag = isPre ? extractPreReleaseTag(chosenVersion) : undefined;

        return {
          ...c,
          newRange: `${prefix}${chosenVersion}`,
          diff,
          selected: true,
          isPreRelease: isPre,
          preReleaseTag: preTag,
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
