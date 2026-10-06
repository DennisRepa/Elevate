import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/config.js';

describe('resolveConfig', () => {
  it('reads internalScopes', () => {
    const config = resolveConfig('/repo', { internalScopes: ['@acme', 'com.acme'] });
    expect(config.internalScopes).toEqual(['@acme', 'com.acme']);
    expect(config.deprecations).toEqual([]);
  });

  it('still honours the deprecated excludeScopes and says so', () => {
    const config = resolveConfig('/repo', { excludeScopes: ['@acme'] });
    expect(config.internalScopes).toEqual(['@acme']);
    expect(config.deprecations[0]).toMatch(/rename it to `internalScopes`/);
  });

  it('prefers internalScopes when both keys are present', () => {
    const config = resolveConfig('/repo', { internalScopes: ['@new'], excludeScopes: ['@old'] });
    expect(config.internalScopes).toEqual(['@new']);
    expect(config.deprecations[0]).toMatch(/ignored/);
  });

  it('applies defaults', () => {
    const config = resolveConfig('/repo', {});
    expect(config).toMatchObject({ internalScopes: [], channel: 'stable', locale: undefined });
  });
});
