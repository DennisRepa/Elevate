import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const PREFIXES = ['CDISC', 'CREQ', 'CDECL', 'CSCAN', 'CALIGN', 'CORIG', 'CREG', 'CCFG', 'CUPD', 'CVER', 'CWIN', 'CUI', 'CECO', 'CLOCK'];
const ID = new RegExp(`\\b((?:${PREFIXES.join('|')})-\\d+)\\b`);

/** IDs of the scenarios the Cargo feature files declare. */
function specIds(): Set<string> {
  const dir = join(ROOT, 'specs');
  const ids = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => /^\d+-cargo-.*\.feature$/.test(f))) {
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      const match = line.match(new RegExp(`^\\s*Scenario(?: Outline)?: ${ID.source}`));
      if (match) ids.add(match[1]!);
    }
  }
  return ids;
}

/** IDs that start the title of a test, in unit and integration tests. */
function testIds(): Set<string> {
  const ids = new Set<string>();
  for (const sub of ['unit', 'integration']) {
    const dir = join(ROOT, 'test', sub);
    for (const file of readdirSync(dir).filter((f) => /\.test\.tsx?$/.test(f) && f !== 'cargo-specs.test.ts')) {
      const text = readFileSync(join(dir, file), 'utf8');
      // `it.each([...])(` may span several lines; the array literal ends in `])`.
      const title = new RegExp(`\\bit(?:\\.each\\(\\[[\\s\\S]*?\\]\\))?\\(\\s*['"\`]${ID.source}`, 'g');
      for (const m of text.matchAll(title)) ids.add(m[1]!);
    }
  }
  return ids;
}

describe('Cargo specifications', () => {
  it('every scenario in the feature files has a test that starts with its ID', () => {
    const tests = testIds();
    const missing = [...specIds()].filter((id) => !tests.has(id)).sort();
    expect(missing).toEqual([]);
  });

  it('every Cargo test ID is a scenario in the feature files', () => {
    const specs = specIds();
    const undocumented = [...testIds()].filter((id) => !specs.has(id)).sort();
    expect(undocumented).toEqual([]);
  });

  it('the feature files exist and every scenario ID is unique', () => {
    const dir = join(ROOT, 'specs');
    const files = readdirSync(dir).filter((f) => /^\d+-cargo-.*\.feature$/.test(f));
    expect(files.length).toBe(7);
    const all: string[] = [];
    for (const file of files) {
      for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
        const m = line.match(new RegExp(`^\\s*Scenario(?: Outline)?: ${ID.source}`));
        if (m) all.push(m[1]!);
      }
    }
    expect(all.length).toBe(new Set(all).size);
  });
});
