import { describe, expect, it } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { PackageList } from '../../src/components/package-list.js';
import { SummaryView } from '../../src/components/summary-view.js';
import { VersionModal } from '../../src/components/version-modal.js';
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

describe('Cargo declarations in the dashboard', () => {
  const crate: UpdateCandidate = {
    coordinate: { identifier: 'serde', artifact: 'serde', ecosystem: 'cargo' },
    currentRange: '1.0.100',
    currentClean: '1.0.100',
    latest: '1.0.229',
    newRange: '1.0.229',
    diff: 'patch',
    scope: 'prod',
    selected: true,
    origin: { kind: 'public' },
    action: 'update',
    qualifier: 'cfg(unix)',
    sharedWith: ['api', 'web'],
    declaration: { file: '/r/Cargo.toml', kind: 'dependency-management', displayPath: 'Cargo.toml' },
  };

  it('CUI-01 a row names where the dependency applies and that others share its version', () => {
    const { lastFrame } = render(<PackageList items={[crate]} cursor={0} loading={false} skipped={[]} t={en} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('serde');
    expect(frame).toContain('(cfg(unix))');
    expect(frame).toContain('[+2 crates]');
  });

  it('CUI-01 the rows are translated', () => {
    const { lastFrame } = render(<PackageList items={[crate]} cursor={0} loading={false} skipped={[]} t={de} />);
    expect(lastFrame()).toContain('[+2 Crates]');
  });

  it('CUI-02 a row without qualifier or sharing shows neither', () => {
    const plain = { ...crate, qualifier: undefined, sharedWith: undefined };
    const frame = render(<PackageList items={[plain]} cursor={0} loading={false} skipped={[]} t={en} />).lastFrame() ?? '';
    expect(frame).not.toContain('crates]');
    expect(frame).not.toContain('(cfg');
  });

  it('CUI-03 the version picker lists the crates that share the declaration', () => {
    const strategy = EcosystemFactory.getStrategy('cargo');
    const { lastFrame } = render(
      <VersionModal
        strategy={strategy}
        candidate={crate}
        config={{ rootDir: '/r', internalScopes: [] }}
        onSelect={() => {}}
        onCancel={() => {}}
        t={en}
      />,
    );
    expect(lastFrame()).toContain('Also changes: api, web');
  });
});
