import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  compareGradleVersions,
  isNewerGradleVersion,
  sortGradleVersions,
} from '../../src/adapters/gradle/gradle-versions.js';
import { FIXTURES } from '../helpers.js';
import { extractPreReleaseTag, isPreReleaseVersion } from '../../src/domain/versions.js';
import { join } from 'node:path';

/** A fixed, deterministic scramble so the order of the input never helps. */
function scramble<T>(items: readonly T[]): T[] {
  return items.map((item, index) => ({ item, key: (index * 7 + 3) % 11 })).sort((a, b) => a.key - b.key).map((e) => e.item);
}

describe('Gradle version order', () => {
  it.each([
    ['numbers', ['10.0', '9.0', '2.0', '2', '1.10', '1.9', '1.0.1', '1.0.0', '1.0']],
    ['qualifiers', ['2.0.0', '2.0.0-SP1', '2.0.0.RELEASE', '2.0.0-GA', '2.0.0.Final', '2.0.0-SNAPSHOT', '2.0.0-RC1', '2.0.0-beta.2', '2.0.0-alpha1', '2.0.0-dev-5', '2.0']],
    ['other strings', ['1.0.0-zzz', '1.0.0-z', '1.0.0.b', '1.0.0.alpha', '1.0.0-aaa', '1.0.0-a', '1.0.0-ZZZ', '1.0.0.CR1', '1.0.0.Beta2', '1.0.0-BETA3', '1.0.0-B05']],
    ['words and strings', ['1.0.0-SP1', '1.0.0.RELEASE', '1.0.0.Final', '1.0.0-b05', '1.0.0.M1', '1.0.0-dev-5']],
    ['flavours', ['33.0.0-jre', '32.0.0-jre', '32.0.0-android', '31.1-jre', '31.0-jre', '31.0-android']],
    ['leftover parts', ['1.0-1', '1.0.1', '1.0.0.0', '1.0.0', '1.0.0-SNAPSHOT', '1.0.0-rc1', '1.0']],
    ['Spring and JUnit', ['5.10.0', '5.10.0-RC1', '5.10.0-M1', '5.9.3', '4.13.2', '4.13', '4.13-rc-1', '4.13-beta-2']],
    ['Android Gradle', ['8.2.0', '8.2.0-rc01', '8.2.0-beta01', '8.2.0-alpha10', '8.2.0-alpha01', '8.1.4']],
    ['dates', ['20240101', '2024.10.1', '2024.9.30', '2024.01.15', '100', '99']],
    ['very large numbers', ['9223372036854775807', '20240101123456', '1.99999', '1.9223372036854775808', '9223372036854775808']],
  ])('GRDVER-01 Versions are sorted newest first: %s', (_case, order) => {
    expect(sortGradleVersions(scramble(order))).toEqual(order);
  });

  it.each([
    ['1.0.0-rc', '1.0.0-RC1'],
    ['2.0.0-sp', '2.0.0-SP1'],
    ['1.0.release', '1.0.RELEASE'],
    ['1.0-1', '1.0.1'],
    ['1.0.1', '1.0_1'],
    ['1.0_1', '1.0+1'],
    ['1.', '1'],
    ['01', '1'],
  ])('GRDVER-02 Some different versions are equal for Gradle: %s and %s', (a, b) => {
    expect(isNewerGradleVersion(a, b)).toBe(false);
    expect(isNewerGradleVersion(b, a)).toBe(false);
  });

  it('GRDVER-02 Equal versions keep the order in which they were reported, without duplicates', () => {
    expect(sortGradleVersions(['1.0.1', '1.0-1', '1.0.1', '1.0_1'])).toEqual(['1.0.1', '1.0-1', '1.0_1']);
  });

  it.each([
    ['1.0.0', '1.0.0.RELEASE', false],
    ['1.0.0', '1.0.0.0', true],
    ['1.0', '1.0.0', true],
    ['1.0.0-rc1', '1.0.0', true],
    ['2.0.0-SNAPSHOT', '2.0.0', true],
    ['2.0.0', '2.0.0-SNAPSHOT', false],
    ['31.0-jre', '31.0-android', false],
    ['31.0-android', '31.0-jre', true],
    ['1.9', '1.10', true],
  ])('GRDVER-03 Only a strictly greater version is newer: %s -> %s', (current, candidate, newer) => {
    expect(isNewerGradleVersion(candidate, current)).toBe(newer);
  });

  it('GRDVER-04 The 203 strings of the corpus have a consistent order', () => {
    const corpus = readFileSync(join(FIXTURES, 'gradle-versions', 'versions-corpus.txt'), 'utf8').split('\n').filter(Boolean);
    expect(corpus).toHaveLength(203);
    for (const a of corpus) {
      expect(compareGradleVersions(a, a)).toBe(0);
      for (const b of corpus) {
        expect(Math.sign(compareGradleVersions(a, b))).toBe(-Math.sign(compareGradleVersions(b, a)) || 0);
      }
    }
    const sorted = sortGradleVersions(corpus);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        expect(compareGradleVersions(sorted[i]!, sorted[j]!), `${sorted[i]} before ${sorted[j]}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it.each([
    ['1.9.20-Beta2', 'BETA'],
    ['2.0.0-RC1', 'RC'],
    ['8.2.0-alpha01', 'ALPHA'],
    ['6.0.0-M1', 'M1'],
    ['3.2.0-SNAPSHOT', 'SNAPSHOT'],
    ['2.0.0-dev-5', 'DEV'],
    ['4.13-beta-2', 'BETA'],
  ])('GRDVER-05 %s is a pre-release (tag %s)', (version, tag) => {
    expect(isPreReleaseVersion(version)).toBe(true);
    expect(extractPreReleaseTag(version)).toBe(tag);
  });

  it.each(['5.3.30.RELEASE', '1.0.0.Final', '2.0.0-SP1', '33.0.0-jre', '32.0.0-android', '2024.01.15'])(
    'GRDVER-05 %s is a release',
    (version) => {
      expect(isPreReleaseVersion(version)).toBe(false);
    },
  );
});
