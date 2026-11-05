import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { VERSION } from '../../src/version.js';
import { CargoIndexClient } from '../../src/adapters/cargo/cargo-index.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

describe('product version', () => {
  it('CECO-05 is the version of package.json', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('CECO-06 is sent as part of the User-Agent to registries', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch;
    await new CargoIndexClient(fetchFn).versions('sparse+https://index.crates.io/', 'log');
    expect((fetchFn as any).mock.calls[0][1].headers['user-agent']).toBe(`elevate/${pkg.version} (+https://github.com/DennisRepa/Elevate)`);
  });
});
