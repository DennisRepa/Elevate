import { describe, expect, it } from 'vitest';
import { cleanJavaVersion, extractPreReleaseTag, isPreReleaseVersion } from '../../src/domain/versions.js';
import { pickLatest } from '../../src/adapters/maven/maven-scanner.js';

describe('isPreReleaseVersion', () => {
  it.each([
    '1.0.0-alpha.1',
    '2.0.0-beta',
    '5.10.0-M1',
    '5.10.0-RC1',
    '1.0.0-rc.2',
    '1.0-SNAPSHOT',
    '6.0.0-preview.1',
    '21-ea+35',
    '1.0b2',
    '4.0.0-dev.3',
  ])('detects %s as pre-release', (version) => {
    expect(isPreReleaseVersion(version)).toBe(true);
  });

  it.each(['1.2.3', '33.0.0-jre', '33.0.0-android', '5.6.15.Final', '2.0.0.RELEASE', '1.0.0+build.5'])(
    'treats %s as a release',
    (version) => {
      expect(isPreReleaseVersion(version)).toBe(false);
    },
  );
});

describe('extractPreReleaseTag', () => {
  it('returns short labels', () => {
    expect(extractPreReleaseTag('5.10.0-M2')).toBe('M2');
    expect(extractPreReleaseTag('1.0.0-beta.1')).toBe('BETA');
    expect(extractPreReleaseTag('1.0b2')).toBe('BETA');
    expect(extractPreReleaseTag('1.0-SNAPSHOT')).toBe('SNAPSHOT');
    expect(extractPreReleaseTag('1.0.0')).toBeUndefined();
  });
});

describe('cleanJavaVersion', () => {
  it('normalises Java versions for SemVer comparison', () => {
    expect(cleanJavaVersion('5.6.15.Final')).toBe('5.6.15');
    expect(cleanJavaVersion('32.0.0-jre')).toBe('32.0.0');
    expect(cleanJavaVersion('21')).toBe('21.0.0');
    expect(cleanJavaVersion('latest')).toBeNull();
  });
});

describe('pickLatest', () => {
  const guava = ['32.0.1-android', '32.0.1-jre', '33.0.0-android', '33.0.0-jre'];

  it('keeps the flavour of the current version', () => {
    expect(pickLatest('32.0.0-jre', guava, 'stable')).toBe('33.0.0-jre');
    expect(pickLatest('32.0.0-android', guava, 'stable')).toBe('33.0.0-android');
  });

  it('filters pre-releases on the stable channel only', () => {
    const newer = ['5.9.1', '5.10.0-M1', '5.10.0'];
    expect(pickLatest('5.9.0', newer.slice(0, 2), 'stable')).toBe('5.9.1');
    expect(pickLatest('5.9.0', newer.slice(0, 2), 'all')).toBe('5.10.0-M1');
  });

  it('returns undefined when nothing newer is allowed', () => {
    expect(pickLatest('1.0.0', ['1.1.0-RC1'], 'stable')).toBeUndefined();
  });
});
