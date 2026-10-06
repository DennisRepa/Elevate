/**
 * 🪶 Elevate — useUpdater hook
 *
 * Runs the shared update workflow (write, install, integrity check,
 * verification, rollback on failure) and exposes progress and result.
 */

import { useState, useCallback } from 'react';
import type { UpdateCandidate, UpdateSummary, View, ProjectModule } from '../domain/models.js';
import type { EcosystemStrategy } from '../domain/ecosystem-strategy.js';
import { runUpdateWorkflow } from '../application/update-workflow.js';

export interface PostUpdateOptions {
  script?: string;
  label?: string;
}

export function useUpdater(
  strategy: EcosystemStrategy,
  rootDir: string,
  setView: (view: View) => void,
  postUpdate?: PostUpdateOptions,
) {
  const [step, setStep] = useState('');
  const [summary, setSummary] = useState<UpdateSummary | null>(null);

  const run = useCallback(
    async (module: ProjectModule, selected: UpdateCandidate[]) => {
      if (selected.length === 0) return;

      setView('updating');
      let result: UpdateSummary;
      try {
        result = await runUpdateWorkflow(strategy, module, rootDir, selected, {
          postUpdateScript: postUpdate?.script,
          postUpdateLabel: postUpdate?.label,
          onProgress: setStep,
        });
      } catch (err) {
        // Only reachable before any file was written (e.g. a snapshot read error).
        result = {
          updatedCount: 0,
          auditMessage: 'Update did not start.',
          auditSeverity: 'warn',
          rolledBack: true,
          failure: err instanceof Error ? err.message : String(err),
        };
      }
      setSummary(result);
      setView('summary');
    },
    [strategy, rootDir, setView, postUpdate],
  );

  return { step, summary, run } as const;
}
