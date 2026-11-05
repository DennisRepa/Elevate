import React from 'react';
import { render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCliArgs } from '../../src/cli/parser.js';
import { ChickenMascot } from '../../src/components/mascot.js';
import { VersionModal } from '../../src/components/version-modal.js';
import { selectRequested } from '../../src/application/update-selection.js';
import { coordinateFromIdentifier } from '../../src/application/version-lookup.js';
import { EcosystemFactory } from '../../src/domain/ecosystem-factory.js';
import { mavenVersionPolicy } from '../../src/domain/version-policy.js';
import type { EcosystemStrategy } from '../../src/domain/ecosystem-strategy.js';
import type { Ecosystem, ScanResult, UpdateCandidate } from '../../src/domain/models.js';
import { matchesInternalScope } from '../../src/domain/origin.js';
import { de } from '../../src/i18n/locales/de.js';
import { en } from '../../src/i18n/locales/en.js';

describe('Gradle is an ecosystem (GRD-01 to GRD-04)', () => {
  it.each([
    ['scan --ecosystem=gradle'],
    ['scan -e gradle'],
    ['modules --ecosystem gradle --json'],
    ['update --ecosystem=gradle --all'],
  ])('GRD-01 The command line accepts gradle as an ecosystem: %s', (arguments_) => {
    expect(parseCliArgs(arguments_.split(' ')).ecosystem).toBe('gradle');
  });

  it('GRD-02 An unknown ecosystem is still ignored', () => {
    expect(parseCliArgs(['scan', '--ecosystem=ant']).ecosystem).toBeUndefined();
  });

  it('GRD-03 The factory knows the Gradle strategy', () => {
    expect(EcosystemFactory.getAvailableEcosystems()).toEqual(['npm', 'maven', 'cargo', 'gradle']);
    const strategy = EcosystemFactory.getStrategy('gradle');
    expect(strategy).toMatchObject({ ecosystem: 'gradle', displayName: 'Java / Gradle', icon: '🐘', manifestFile: 'build.gradle' });
    expect(EcosystemFactory.getStrategy('gradle')).toBe(strategy);
  });

  it.each([
    ['npm', 'maven', '[E] ☕ Java / Maven'],
    ['maven', 'cargo', '[E] 🦀 Rust / Cargo'],
    ['cargo', 'gradle', '[E] 🐘 Java / Gradle'],
    ['gradle', 'npm', '[E] 📦 Node / npm'],
  ] as const)('GRD-04 The dashboard cycles from %s to %s', (current, next, hint) => {
    expect(EcosystemFactory.next(current)).toBe(next);
    const target = EcosystemFactory.getStrategy(next);
    expect(en.header.ecosystemToggleHint(`${target.icon} ${target.displayName}`)).toBe(hint);
  });
});

describe('Gradle shares the coordinate handling of Maven (GRD-06)', () => {
  it('uses the version policy of Maven, which does not allow manual targets', () => {
    const policy = EcosystemFactory.getStrategy('gradle').versioning;
    expect(policy).toBe(mavenVersionPolicy);
    expect(policy.allowsManualTargets).toBe(false);
  });

  it('builds the coordinate of group:name', () => {
    expect(coordinateFromIdentifier('com.acme:lib', 'gradle')).toMatchObject({ group: 'com.acme', artifact: 'lib', ecosystem: 'gradle' });
  });

  it('matches internal scopes on segment boundaries', () => {
    expect(matchesInternalScope('com.acme.billing:core', 'gradle', ['com.acme'])).toBe(true);
    expect(matchesInternalScope('com.acmecorp:core', 'gradle', ['com.acme'])).toBe(false);
  });

  it('chooses a version by hand', () => {
    const lib: UpdateCandidate = {
      coordinate: { identifier: 'org.example:lib', group: 'org.example', artifact: 'lib', ecosystem: 'gradle' },
      currentRange: '5.9.0', currentClean: '5.9.0', latest: '5.9.1', newRange: '5.9.1', diff: 'patch', scope: 'prod',
      selected: true, origin: { kind: 'public' }, action: 'update', availableVersions: ['5.10.2', '5.9.1', '5.9.0'],
    };
    const scan: ScanResult = { candidates: [lib], skipped: [] };
    const [chosen] = selectRequested(scan, [{ identifier: 'org.example:lib', targetVersion: '5.10.2' }], {
      ecosystem: 'gradle', allowMajor: false, originOf: () => 'public',
    });
    expect(chosen).toMatchObject({ newRange: '5.10.2', diff: 'minor', isCustomVersion: true });
  });

  it('gives the same message as Maven for a dependency without an offered update', () => {
    const scan: ScanResult = { candidates: [], skipped: [] };
    const attempt = (ecosystem: Ecosystem) =>
      selectRequested(scan, [{ identifier: 'org.example:lib', targetVersion: '1.0' }], { ecosystem, allowMajor: false, originOf: () => 'public' });
    const message = /has no pending update\. Updates are written where the scan located the version/;
    expect(() => attempt('gradle')).toThrow(message);
    expect(() => attempt('maven')).toThrow(message);
  });
});

describe('what the dashboard shows (GRD-52, GRD-53)', () => {
  it('GRD-52 The tabs are named in the language of the user', () => {
    const counts = { total: 12, prodCount: 8, devCount: 4 };
    const strategy = EcosystemFactory.getStrategy('gradle');
    expect(strategy.getTabLabels(counts, en)).toEqual({ all: '[1] All (12)', prod: '[2] Main (8)', dev: '[3] Test & plugins (4)' });
    expect(strategy.getTabLabels(counts, de)).toEqual({ all: '[1] Alle (12)', prod: '[2] Haupt (8)', dev: '[3] Test & Plugins (4)' });
  });

  describe('GRD-53 The mascot of a Gradle repository drinks coffee like the Maven one', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const chirps = async (ecosystem: Ecosystem): Promise<string> => {
      const { lastFrame, unmount } = render(<ChickenMascot state="idle" t={en} ecosystem={ecosystem} />);
      let seen = '';
      for (let i = 0; i < en.mascot.idleChirps.length + en.mascot.mavenChirps.length; i++) {
        seen += lastFrame();
        await vi.advanceTimersByTimeAsync(4200);
      }
      unmount();
      return seen;
    };

    it.each(['maven', 'gradle'] as const)('%s', async (ecosystem) => {
      expect(await chirps(ecosystem)).toContain('*sipping coffee* ☕');
    });

    it('npm does not', async () => {
      expect(await chirps('npm')).not.toContain('*sipping coffee* ☕');
    });
  });
});

describe('the version picker (GRDVER-50)', () => {
  it('needs no further Gradle run for a scanned candidate', async () => {
    const lookups: string[] = [];
    const strategy = {
      registry: {
        getAllVersions: async (coordinate: { identifier: string }) => {
          lookups.push(coordinate.identifier);
          return [];
        },
        resolveEndpoint: async () => ({ url: 'x', isPublic: false }),
      },
    } as unknown as EcosystemStrategy;
    const candidate: UpdateCandidate = {
      coordinate: { identifier: 'org.example:a', group: 'org.example', artifact: 'a', ecosystem: 'gradle' },
      currentRange: '1.0', currentClean: '1.0.0', latest: '1.2', newRange: '1.2', diff: 'minor', scope: 'prod', selected: true,
      origin: { kind: 'public' }, action: 'update', availableVersions: ['1.2', '1.1', '1.0'],
    };
    const { lastFrame, unmount } = render(
      <VersionModal candidate={candidate} strategy={strategy} config={{ rootDir: '/r', internalScopes: [] }} t={en} onSelect={() => {}} onCancel={() => {}} />,
    );
    await new Promise((done) => setTimeout(done, 20));
    expect(lookups).toEqual([]);
    expect(lastFrame()).toContain('1.1');
    unmount();
  });
});
