import { describe, expect, it } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { PackageList } from '../../src/components/package-list.js';
import { SummaryView } from '../../src/components/summary-view.js';
import { en } from '../../src/i18n/locales/en.js';
import { de } from '../../src/i18n/locales/de.js';
import { EcosystemFactory } from '../../src/domain/ecosystem-factory.js';
import type { ProjectModule, UpdateCandidate } from '../../src/domain/models.js';

const aligned: UpdateCandidate = {
  coordinate: { identifier: '@acme/core', artifact: '@acme/core', ecosystem: 'npm' },
  currentRange: '^1.0.0',
  currentClean: '1.0.0',
  latest: '2.0.0',
  newRange: '^2.0.0',
  diff: 'major',
  scope: 'prod',
  selected: false,
  origin: { kind: 'workspace', moduleId: '@acme/core', moduleRelPath: 'packages/core' },
  action: 'align',
};

describe('PackageList', () => {
  it('marks alignments and lists dependencies that were not offered', () => {
    const { lastFrame } = render(
      <PackageList
        items={[aligned]}
        cursor={0}
        loading={false}
        skipped={[{ identifier: '@acme/secret-sdk', origin: 'private', reason: 'private-on-public-registry' }]}
        t={en}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('@acme/core');
    expect(frame).toContain('[Align]');
    expect(frame).toContain('1 dependency not offered');
    expect(frame).toContain('@acme/secret-sdk: internal package, but its registry is public');
  });

  it('shows a scan error instead of claiming everything is up to date', () => {
    const { lastFrame } = render(
      <PackageList items={[]} cursor={0} loading={false} skipped={[]} error={'Maven is not available'} t={de} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Scan fehlgeschlagen: Maven is not available');
    expect(frame).not.toContain(de.list.allUpToDate);
  });
});

describe('SummaryView', () => {
  const module = { relPath: 'apps/web' } as ProjectModule;
  const strategy = EcosystemFactory.getStrategy('npm');

  it('reports a rollback with its reason', () => {
    const { lastFrame } = render(
      <SummaryView
        summary={{
          updatedCount: 0,
          auditMessage: 'Update was rolled back.',
          auditSeverity: 'warn',
          rolledBack: true,
          failure: 'Integrity check failed:\n• @acme/core: installed from registry',
        }}
        module={module}
        strategy={strategy}
        t={en}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('all changes were rolled back');
    expect(frame).toContain('@acme/core: installed from registry');
  });
});
