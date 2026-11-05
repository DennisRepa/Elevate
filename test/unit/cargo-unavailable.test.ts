import { afterEach, describe, expect, it } from 'vitest';
import { CargoModuleDiscoveryAdapter } from '../../src/adapters/cargo/cargo-discovery.js';
import { CargoUnavailableError } from '../../src/adapters/cargo/cargo-command.js';
import { cleanupTemp, makeTree } from '../helpers.js';

afterEach(cleanupTemp);

describe('Cargo not installed', () => {
  it('CDISC-10 a machine without cargo gets a clear error instead of an empty list', async () => {
    const root = makeTree({ 'Cargo.toml': '[package]\nname="x"\n' });
    const path = process.env.PATH;
    process.env.PATH = '';
    try {
      await expect(new CargoModuleDiscoveryAdapter().discover(root)).rejects.toBeInstanceOf(CargoUnavailableError);
    } finally {
      process.env.PATH = path;
    }
  });
});
