/**
 * 🪶 Elevate — useUpdater Hook (Domain-Driven)
 *
 * Führt den Update-Workflow über DependencyUpdaterPort und
 * VerificationPort der aktuellen Ökosystem-Strategie aus.
 */

import { useState, useCallback } from 'react';
import type { UpdateCandidate, UpdateSummary, View, ProjectModule } from '../domain/models.js';
import type { EcosystemStrategy } from '../domain/ecosystem-strategy.js';
import type { Translations } from '../i18n/types.js';

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
    async (module: ProjectModule, selected: UpdateCandidate[], _t: Translations) => {
      if (selected.length === 0) return;

      setView('updating');

      // 1. & 2. & 3. Update & Build via Updater Adapter
      const updaterResult = await strategy.updater.applyUpdates(
        module,
        rootDir,
        selected,
        (progressMessage) => setStep(progressMessage),
      );

      // 4. Verifikation via Verifier Adapter
      setStep('Führe Verifikation und Konsistenzchecks durch…');
      const verifierResult = await strategy.verifier.verify(
        module,
        rootDir,
        postUpdate?.script,
        postUpdate?.label,
      );

      setSummary({
        ...updaterResult,
        verificationStatus: verifierResult.status,
        verificationDetails: verifierResult.details,
        verificationLabel: verifierResult.label,
      });

      setView('summary');
    },
    [strategy, rootDir, setView, postUpdate],
  );

  return { step, summary, run } as const;
}
