/**
 * 🪶 Elevate — useWorkspaces Hook (Domain-Driven)
 *
 * Verwaltet Module des aktuell aktiven Ökosystems über die
 * ModuleDiscoveryPort-Schnittstelle.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import type { ProjectModule } from '../domain/models.js';
import type { EcosystemStrategy } from '../domain/ecosystem-strategy.js';

export function useWorkspaces(strategy: EcosystemStrategy, rootDir: string) {
  const [modules, setModules] = useState<ProjectModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);

  // Module anhand der aktuellen Ökosystem-Strategie laden
  const reload = useCallback(async () => {
    setLoading(true);
    setModules([]);
    setActiveIndex(0);
    try {
      const found = await strategy.discovery.discover(rootDir);
      setModules(found);
      setActiveIndex(0);
    } catch {
      setModules([]);
    } finally {
      setLoading(false);
    }
  }, [strategy, rootDir]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Interne IDs sammeln (für Symlink-/Monorepo-Schutz)
  const internalIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of modules) {
      if (m.id) ids.add(m.id);
      if (m.name) ids.add(m.name);
    }
    return ids;
  }, [modules]);

  const active: ProjectModule = modules[activeIndex] || {
    id: 'empty',
    name: 'Kein Modul gefunden',
    path: rootDir,
    relPath: 'Root',
    ecosystem: strategy.ecosystem,
    isRoot: true,
  };

  return {
    modules,
    active,
    activeIndex,
    setActiveIndex,
    internalIds,
    loading,
    reload,
  } as const;
}
