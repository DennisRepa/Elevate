import { describe, expect, it } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { UpdateSelectionError, selectAll, selectRequested } from '../../src/application/update-selection.js';
import { PackageList } from '../../src/components/package-list.js';
import { candidateToJson } from '../../src/application/scan.js';
import { en } from '../../src/i18n/locales/en.js';
import { de } from '../../src/i18n/locales/de.js';
import type { ScanResult, UpdateCandidate } from '../../src/domain/models.js';

const lock: UpdateCandidate = {
  coordinate: { identifier: 'itoa', artifact: 'itoa', ecosystem: 'cargo' },
  currentRange: '1.0.15',
  currentClean: '1.0.15',
  latest: '1.0.18',
  newRange: '1.0.18',
  diff: 'patch',
  scope: 'prod',
  selected: true,
  origin: { kind: 'public' },
  action: 'lock',
  declaration: { file: '/r/Cargo.lock', kind: 'lockfile', displayPath: 'Cargo.lock' },
  availableVersions: ['1.0.18', '1.0.16'],
};
const scan: ScanResult = { candidates: [lock], skipped: [] };
const options = { ecosystem: 'cargo' as const, allowMajor: false, originOf: () => 'public' as const };

describe('lock-file-only updates in the shared layers', () => {
  it('CLOCK-19 a request without a version takes the newest release the requirement allows', () => {
    const [picked] = selectRequested(scan, [{ identifier: 'itoa' }], options);
    expect(picked).toMatchObject({ action: 'lock', latest: '1.0.18', newRange: '1.0.18' });
  });

  it('CLOCK-19 a request may pick another release the requirement allows', () => {
    const [picked] = selectRequested(scan, [{ identifier: 'itoa', targetVersion: '1.0.16' }], options);
    expect(picked).toMatchObject({ action: 'lock', latest: '1.0.16', newRange: '1.0.16', diff: 'patch', isCustomVersion: true });
  });

  it('CLOCK-19 a release the requirement does not allow is refused, with the ones that are allowed', () => {
    expect(() => selectRequested(scan, [{ identifier: 'itoa', targetVersion: '2.0.0' }], options)).toThrow(UpdateSelectionError);
    expect(() => selectRequested(scan, [{ identifier: 'itoa', targetVersion: '2.0.0' }], options)).toThrow(/1\.0\.18, 1\.0\.16/);
  });

  it('CLOCK-20 all lock updates are selected with the others, majors excluded as before', () => {
    expect(selectAll(scan, false).selected.map((c) => c.coordinate.identifier)).toEqual(['itoa']);
  });

  it('CLOCK-21 the JSON output names the action and the lock file', () => {
    expect(candidateToJson(lock)).toMatchObject({ identifier: 'itoa', action: 'lock', declaredIn: { file: 'Cargo.lock', kind: 'lockfile' } });
  });

  it('CLOCK-22 a row is marked as a lock update, in both languages', () => {
    for (const t of [en, de]) {
      const frame = render(React.createElement(PackageList, { items: [lock], cursor: 0, loading: false, skipped: [], t })).lastFrame() ?? '';
      expect(frame).toContain('1.0.15');
      expect(frame).toContain('1.0.18');
      expect(frame).toContain('[Lock]');
    }
  });
});
