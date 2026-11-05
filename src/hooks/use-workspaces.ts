/**
 * 🪶 Elevate — useWorkspaces hook
 *
 * Loads the modules of the active ecosystem through its ModuleDiscoveryPort
 * and tracks which module is selected.
 */

import { useState, useEffect, useCallback } from 'react';
import type { ProjectModule } from '../domain/models.js';
import { discoverModules } from '../application/scan.js';
import type { EcosystemStrategy } from '../domain/ecosystem-strategy.js';

export function useWorkspaces(strategy: EcosystemStrategy, rootDir: string) {
  const [modules, setModules] = useState<ProjectModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);

  // Reload modules whenever the ecosystem strategy changes.
  const reload = useCallback(async () => {
    setLoading(true);
    setModules([]);
    setActiveIndex(0);
    setDiagnostics([]);
    try {
      const found = await discoverModules(strategy, rootDir);
      setModules(found.modules);
      setDiagnostics(found.diagnostics);
    } catch (err) {
      // A failed discovery is shown, not mistaken for "no modules".
      setModules([]);
      setDiagnostics([err instanceof Error ? err.message : String(err)]);
    } finally {
      setLoading(false);
    }
  }, [strategy, rootDir]);

  useEffect(() => {
    reload();
  }, [reload]);

  const active: ProjectModule = modules[activeIndex] || {
    id: 'empty',
    name: 'No module found',
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
    loading,
    diagnostics,
    reload,
  } as const;
}
