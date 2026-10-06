import { describe, expect, it } from 'vitest';
import { ChangelogError, checkUnreleased, notes, release } from '../../scripts/changelog.mjs';

const CHANGELOG = `# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Features

* **config:** a broken configuration stops Elevate

### Fixes

* **npm:** info vulnerabilities are reported

## 1.2.0 (2026-09-28)

### Features

* **core:** initial release of Elevate
`;

const NO_ENTRIES =
  'CHANGELOG.md has no entries under "Unreleased". Describe the changes of this release there before releasing.';

/** Replaces the body of a section, keeping its heading. */
function withBody(source: string, heading: string, body: string): string {
  const start = source.indexOf(`## ${heading}`);
  const next = source.indexOf('\n## ', start + 1);
  const end = next === -1 ? source.length : next + 1;
  return `${source.slice(0, start)}## ${heading}\n\n${body}${body ? '\n\n' : ''}${source.slice(end)}`;
}

function failure(action: () => unknown): ChangelogError {
  try {
    action();
  } catch (err) {
    expect(err).toBeInstanceOf(ChangelogError);
    return err as ChangelogError;
  }
  throw new Error('did not fail');
}

describe('releasing turns Unreleased into the version', () => {
  it('REL-01 The new version gets a heading with the date and Unreleased starts empty', () => {
    const result = release(CHANGELOG, '1.3.0', '2026-10-06');
    expect(result).toContain(
      '## Unreleased\n\n## 1.3.0 (2026-10-06)\n\n### Features\n\n* **config:** a broken configuration stops Elevate',
    );
    expect(result).toContain('## 1.2.0 (2026-09-28)\n\n### Features\n\n* **core:** initial release of Elevate\n');
    expect(result.startsWith(CHANGELOG.slice(0, CHANGELOG.indexOf('## Unreleased')))).toBe(true);
  });

  it('REL-02 Line endings of the file are kept', () => {
    const result = release(CHANGELOG.replace(/\n/g, '\r\n'), '1.3.0', '2026-10-06');
    expect(result).toContain('## 1.3.0 (2026-10-06)');
    expect(result.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it.each([
    ['nothing', ''],
    ['only the heading "### Fixes"', '### Fixes'],
    ['only a paragraph of prose', 'Nothing has been written down yet.'],
  ])('REL-03 A release without entries is refused: %s', (_label, body) => {
    const source = withBody(CHANGELOG, 'Unreleased', body);
    expect(failure(() => release(source, '1.3.0', '2026-10-06')).message).toBe(NO_ENTRIES);
    expect(failure(() => checkUnreleased(source)).message).toBe(NO_ENTRIES);
  });

  it('REL-04 A version that already has a section is refused', () => {
    expect(failure(() => release(CHANGELOG, '1.2.0', '2026-10-06')).message).toBe(
      'CHANGELOG.md already has a section for 1.2.0.',
    );
  });

  it('REL-05 A missing Unreleased section is refused', () => {
    const source = CHANGELOG.replace('## Unreleased', '## Upcoming');
    expect(failure(() => release(source, '1.3.0', '2026-10-06')).message).toBe(
      'CHANGELOG.md has no "## Unreleased" section.',
    );
  });
});

describe('the release notes are the section of the version', () => {
  it('REL-06 The notes are the section without its heading', () => {
    expect(notes(CHANGELOG, '1.2.0')).toBe('### Features\n\n* **core:** initial release of Elevate\n');
  });

  it('REL-07 The notes of a released section end at the next second-level heading', () => {
    const released = release(CHANGELOG, '1.3.0', '2026-10-06');
    const text = notes(released, '1.3.0');
    expect(text.startsWith('### Features')).toBe(true);
    expect(text).toContain('### Fixes');
    expect(text).toContain('info vulnerabilities are reported');
    expect(text).not.toContain('initial release of Elevate');
  });

  it('REL-08 A pre-release version is not confused with its final version', () => {
    const released = release(CHANGELOG, '1.3.0-rc.1', '2026-10-01');
    expect(failure(() => notes(released, '1.3.0')).message).toBe('CHANGELOG.md has no section for 1.3.0.');
    expect(notes(released, '1.3.0-rc.1')).toContain('a broken configuration stops Elevate');
  });

  it('REL-09 A version without a section is refused', () => {
    expect(failure(() => notes(CHANGELOG, '9.9.9')).message).toBe('CHANGELOG.md has no section for 9.9.9.');
  });

  it('REL-10 A section without entries is refused', () => {
    const source = withBody(CHANGELOG, '1.2.0 (2026-09-28)', '### Features');
    expect(failure(() => notes(source, '1.2.0')).message).toBe('The CHANGELOG.md section for 1.2.0 has no entries.');
  });
});
