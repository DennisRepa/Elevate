import { describe, expect, it } from 'vitest';
import { cargoErrors } from '../../src/adapters/cargo/cargo-command.js';

describe('cargo error summaries', () => {
  it('CVER-06 keeps the error lines', () => {
    expect(cargoErrors('Checking x\nerror[E0308]: mismatched types\n --> a.rs\nerror: could not compile `x`')).toBe(
      'error[E0308]: mismatched types\nerror: could not compile `x`',
    );
  });

  it('CVER-07 a toolchain that rustup does not have says how to get it', () => {
    const text = "error: toolchain '1.80.0-x86_64-unknown-linux-gnu' is not installed";
    expect(cargoErrors(text)).toBe(`${text}\nInstall it with \`rustup toolchain install\` (the project pins it in rust-toolchain.toml).`);
  });
});
