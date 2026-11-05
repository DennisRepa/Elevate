import { afterEach, describe, expect, it, vi } from 'vitest';

const process_ = vi.hoisted(() => ({ runCommand: vi.fn() }));
vi.mock('../../src/adapters/shared/process.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/adapters/shared/process.js')>()),
  runCommand: process_.runCommand,
}));

import { CargoUnavailableError, cargoErrors, runCargo } from '../../src/adapters/cargo/cargo-command.js';

const answer = (exitCode: number, stderr = '', stdout = '') => ({ exitCode, stdout, stderr, timedOut: false });

function onPlatform(platform: NodeJS.Platform) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: platform });
  return () => Object.defineProperty(process, 'platform', original);
}

afterEach(() => process_.runCommand.mockReset());

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

  it('CDISC-17 a Windows shell that cannot find cargo is reported as a missing cargo, in any language', async () => {
    const restore = onPlatform('win32');
    try {
      process_.runCommand.mockImplementation(async (...call: any[]) =>
        call.length ? answer(1, "'cargo' wird nicht als interner oder externer Befehl erkannt.") : answer(0),
      );
      await expect(runCargo(['metadata'], { cwd: '/x' })).rejects.toBeInstanceOf(CargoUnavailableError);
      expect(process_.runCommand).toHaveBeenCalledWith('cargo', ['--version'], expect.anything());
    } finally {
      restore();
    }
  });

  it('CDISC-17 a failing cargo that prints an error is not mistaken for a missing cargo', async () => {
    const restore = onPlatform('win32');
    try {
      process_.runCommand.mockImplementation(async (...call: any[]) => (call.length ? answer(101, 'error: could not find `Cargo.toml`') : answer(0)));
      await expect(runCargo(['metadata'], { cwd: '/x' })).resolves.toMatchObject({ exitCode: 101 });
      expect(process_.runCommand).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it('CDISC-17 cargo that works but fails quietly is not mistaken for a missing cargo', async () => {
    const restore = onPlatform('win32');
    try {
      process_.runCommand.mockImplementation(async (...call: any[]) => (call.length && call[1][0] !== '--version' ? answer(1, 'something odd') : answer(0)));
      await expect(runCargo(['metadata'], { cwd: '/x' })).resolves.toMatchObject({ exitCode: 1 });
    } finally {
      restore();
    }
  });
});
