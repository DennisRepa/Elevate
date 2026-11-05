import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { CargoConfigReader, UnsupportedSourceError } from '../../src/adapters/cargo/cargo-config.js';
import { cleanupTemp, makeTree } from '../helpers.js';

afterEach(cleanupTemp);

const GIT = 'registry+https://github.com/rust-lang/crates.io-index';
const MIRROR = 'sparse+https://mirror.example/crates/';
const replaced = (name = 'mirror', url = MIRROR) =>
  `[source.crates-io]\nreplace-with = "${name}"\n[source.${name}]\nregistry = "${url}"\n`;

function reader(tree: Record<string, string>, env: Record<string, string> = {}) {
  const root = makeTree(tree);
  const home = join(root, 'home');
  return { root, read: new CargoConfigReader({ env: { CARGO_HOME: home, ...env } }) };
}

describe('Cargo registry configuration', () => {
  it('CCFG-01 without configuration crates.io is the public default', async () => {
    const { root, read } = reader({ 'x': '' });
    expect(await read.resolve(undefined, root)).toEqual({ index: GIT, isPublic: true });
  });

  it('CCFG-02 a replaced source is followed and is not public', async () => {
    const { root, read } = reader({ '.cargo/config.toml': replaced() });
    expect(await read.resolve(undefined, root)).toEqual({ index: MIRROR, isPublic: false });
  });

  it('CCFG-03 configuration is found in parent directories; the nearest file wins, CARGO_HOME comes last', async () => {
    const tree = {
      '.cargo/config.toml': replaced('outer', 'sparse+https://outer.example/'),
      'proj/.cargo/config.toml': replaced('inner', 'sparse+https://inner.example/'),
      'home/config.toml': replaced('home', 'sparse+https://home.example/'),
      'proj/sub/x': '',
    };
    const { root, read } = reader(tree);
    expect((await read.resolve(undefined, join(root, 'proj/sub'))).index).toBe('sparse+https://inner.example/');
    expect((await read.resolve(undefined, root)).index).toBe('sparse+https://outer.example/');
    const homeOnly = reader({ 'home/config.toml': replaced('home', 'sparse+https://home.example/'), 'x': '' });
    expect((await homeOnly.read.resolve(undefined, homeOnly.root)).index).toBe('sparse+https://home.example/');
  });

  it('CCFG-04 an included file is read, with lower precedence than the file that includes it', async () => {
    const { root, read } = reader({
      '.cargo/config.toml': 'include = ["extra.toml"]\n[source.mirror]\nregistry = "sparse+https://own.example/"\n',
      '.cargo/extra.toml': replaced('mirror', 'sparse+https://included.example/'),
    });
    expect((await read.resolve(undefined, root)).index).toBe('sparse+https://own.example/');
  });

  it('CCFG-05 CARGO_SOURCE_* variables are ignored, as Cargo ignores them (checked against Cargo 1.97)', async () => {
    const withFile = reader(
      { '.cargo/config.toml': replaced('mirror', 'sparse+https://file.example/') },
      { CARGO_SOURCE_MIRROR_REGISTRY: 'sparse+https://env.example/' },
    );
    expect((await withFile.read.resolve(undefined, withFile.root)).index).toBe('sparse+https://file.example/');

    const onlyEnv = reader({ x: '' }, { CARGO_SOURCE_CRATES_IO_REPLACE_WITH: 'm', CARGO_SOURCE_M_REGISTRY: MIRROR });
    expect(await onlyEnv.read.resolve(undefined, onlyEnv.root)).toEqual({ index: GIT, isPublic: true });
  });

  it.each(['directory = "vendor"', 'local-registry = "reg"', 'git = "https://example.com/x.git"'])(
    'CCFG-06 a replacement Elevate cannot read (%s) is refused instead of falling back to crates.io',
    async (body) => {
      const { root, read } = reader({ '.cargo/config.toml': `[source.crates-io]\nreplace-with = "v"\n[source.v]\n${body}\n` });
      await expect(read.resolve(undefined, root)).rejects.toBeInstanceOf(UnsupportedSourceError);
    },
  );

  it('CCFG-07 an alternative registry index passes through and is public only on crates.io hosts', async () => {
    const { root, read } = reader({ x: '' });
    expect(await read.resolve('sparse+https://corp.example/idx/', root)).toEqual({ index: 'sparse+https://corp.example/idx/', isPublic: false });
    expect((await read.resolve('sparse+https://index.crates.io/', root)).isPublic).toBe(true);
  });

  it('CCFG-08 a replacement cycle is refused', async () => {
    const { root, read } = reader({
      '.cargo/config.toml': '[source.crates-io]\nreplace-with = "a"\n[source.a]\nreplace-with = "b"\n[source.b]\nreplace-with = "a"\n',
    });
    await expect(read.resolve(undefined, root)).rejects.toBeInstanceOf(UnsupportedSourceError);
  });
});
