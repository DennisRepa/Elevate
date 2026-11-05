import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { VERSION } from '../../src/version.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

describe('product version', () => {
  it('CECO-05 is the version of package.json', () => {
    expect(VERSION).toBe(pkg.version);
  });
});
