import { describe, expect, it } from 'vitest';
import { EcosystemFactory } from '../../src/domain/ecosystem-factory.js';
import { parseCliArgs } from '../../src/cli/parser.js';
import { CargoRegistryAdapter } from '../../src/adapters/cargo/cargo-registry.js';
import type { IndexVersion } from '../../src/adapters/cargo/cargo-index.js';

const v = (version: string, yanked = false): IndexVersion => ({ version, yanked, rustVersion: undefined });

describe('Cargo ecosystem', () => {
  it('CECO-01 is registered next to npm and Maven', () => {
    expect(EcosystemFactory.getAvailableEcosystems()).toEqual(['npm', 'maven', 'cargo']);
    const strategy = EcosystemFactory.getStrategy('cargo');
    expect(strategy).toMatchObject({ ecosystem: 'cargo', manifestFile: 'Cargo.toml', icon: '🦀' });
    expect(EcosystemFactory.getStrategy('cargo')).toBe(strategy);
  });

  it('CECO-02 rotates through all ecosystems', () => {
    expect(EcosystemFactory.next('npm')).toBe('maven');
    expect(EcosystemFactory.next('maven')).toBe('cargo');
    expect(EcosystemFactory.next('cargo')).toBe('npm');
  });

  it('CECO-03 uses Cargo version rules', () => {
    const policy = EcosystemFactory.getStrategy('cargo').versioning;
    expect(policy.rewrite('1.0.100', '1.0.229')).toBe('1.0.229');
    expect(policy.rewrite('1', '2.3.4')).toBe('2');
    expect(policy.diff('0.4.2', '0.5.0')).toBe('major');
    expect(policy.normalize('1.2.3')).toBe('1.2.3');
    expect(policy.allowsManualTargets).toBe(false);
  });

  it('CECO-04 is selectable on the command line', () => {
    expect(parseCliArgs(['scan', '--ecosystem=cargo']).ecosystem).toBe('cargo');
    expect(parseCliArgs(['scan', '-e', 'cargo']).ecosystem).toBe('cargo');
  });

  it('CREG-09 registry port: latest honours the channel and yanked flag, all versions come newest first', async () => {
    const registry = new CargoRegistryAdapter({
      index: { versions: async () => [v('1.0.0'), v('1.2.0', true), v('1.1.0'), v('2.0.0-rc.1')] },
      endpoint: async (registry) => ({ index: registry ?? 'default', isPublic: !registry }),
    });
    const coordinate = { identifier: 'x', artifact: 'x', ecosystem: 'cargo' as const };
    expect(await registry.getLatestVersion(coordinate, 'stable', '/')).toBe('1.1.0');
    expect(await registry.getLatestVersion(coordinate, 'all', '/')).toBe('2.0.0-rc.1');
    expect(await registry.getAllVersions(coordinate, '/')).toEqual(['2.0.0-rc.1', '1.1.0', '1.0.0']);
    expect(await registry.resolveEndpoint({ ...coordinate, registry: 'sparse+https://c/' }, '/')).toEqual({ url: 'sparse+https://c/', isPublic: false });
  });
});
