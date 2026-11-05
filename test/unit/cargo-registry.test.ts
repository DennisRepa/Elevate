import { describe, expect, it, vi } from 'vitest';
import {
  CargoIndexClient,
  CrateNotFoundError,
  RegistryAuthRequiredError,
  UnsupportedIndexError,
  indexPath,
  parseIndex,
} from '../../src/adapters/cargo/cargo-index.js';
import { selectVersion } from '../../src/adapters/cargo/cargo-versions.js';

const line = (vers: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name: 'x', vers, deps: [], cksum: 'c', features: {}, yanked: false, ...extra });

function respond(status: number, body = ''): typeof fetch {
  return vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;
}

describe('sparse index paths', () => {
  it.each([
    ['a', '1/a'],
    ['cc', '2/cc'],
    ['log', '3/l/log'],
    ['itoa', 'it/oa/itoa'],
    ['serde_json', 'se/rd/serde_json'],
    ['Serde', 'se/rd/serde'],
  ])('CREG-01 %s -> %s', (name, path) => {
    expect(indexPath(name)).toBe(path);
  });
});

describe('index parsing', () => {
  it('CREG-02 reads versions, yanked flag and rust_version; ignores unknown fields and blank lines', () => {
    const text = [line('1.0.0'), '', line('1.0.1', { yanked: true, rust_version: '1.68', future: 1 })].join('\n');
    expect(parseIndex(text)).toEqual([
      { version: '1.0.0', yanked: false, rustVersion: undefined },
      { version: '1.0.1', yanked: true, rustVersion: '1.68' },
    ]);
  });
});

describe('index client', () => {
  it('CREG-12 requests <index>/<prefix>/<name> with a User-Agent', async () => {
    const fetchFn = respond(200, line('1.0.0'));
    await new CargoIndexClient(fetchFn).versions('sparse+https://index.crates.io/', 'itoa');
    const [url, init] = (fetchFn as any).mock.calls[0];
    expect(url).toBe('https://index.crates.io/it/oa/itoa');
    expect(init.headers['user-agent']).toMatch(/^elevate\//);
  });

  it('CREG-05 the legacy crates.io git index maps to the sparse index', async () => {
    const fetchFn = respond(200, line('1.0.0'));
    await new CargoIndexClient(fetchFn).versions('registry+https://github.com/rust-lang/crates.io-index', 'log');
    expect((fetchFn as any).mock.calls[0][0]).toBe('https://index.crates.io/3/l/log');
  });

  it('CREG-13 another git index is refused without a request', async () => {
    const fetchFn = respond(200, '');
    await expect(new CargoIndexClient(fetchFn).versions('registry+https://example.com/idx', 'log')).rejects.toBeInstanceOf(
      UnsupportedIndexError,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([401, 403])('CREG-06 status %i means authentication is required and no token is sent', async (status) => {
    const fetchFn = respond(status);
    await expect(new CargoIndexClient(fetchFn).versions('sparse+https://corp.example/idx/', 'x')).rejects.toBeInstanceOf(
      RegistryAuthRequiredError,
    );
    expect(JSON.stringify((fetchFn as any).mock.calls[0][1])).not.toMatch(/authorization/i);
  });

  it('CREG-08 404 is an unknown crate', async () => {
    await expect(new CargoIndexClient(respond(404)).versions('sparse+https://index.crates.io/', 'nope')).rejects.toBeInstanceOf(
      CrateNotFoundError,
    );
  });

  it('CREG-10 a network failure with a proxy configured but not enabled for fetch points at NODE_USE_ENV_PROXY', async () => {
    const down = vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND index.crates.io'), { code: 'ENOTFOUND' }) });
    }) as unknown as typeof fetch;
    const index = 'sparse+https://index.crates.io/';

    const proxied = new CargoIndexClient(down, { HTTPS_PROXY: 'http://proxy:3128' });
    await expect(proxied.versions(index, 'log')).rejects.toThrow(/ENOTFOUND.*NODE_USE_ENV_PROXY=1/s);

    const enabled = new CargoIndexClient(down, { HTTPS_PROXY: 'http://proxy:3128', NODE_USE_ENV_PROXY: '1' });
    await expect(enabled.versions(index, 'log')).rejects.not.toThrow(/NODE_USE_ENV_PROXY/);

    const direct = new CargoIndexClient(down, {});
    await expect(direct.versions(index, 'log')).rejects.toThrow(/ENOTFOUND/);
    await expect(direct.versions(index, 'log')).rejects.not.toThrow(/NODE_USE_ENV_PROXY/);
  });

  it('CREG-11 memoises per index and crate', async () => {
    const fetchFn = respond(200, line('1.0.0'));
    const client = new CargoIndexClient(fetchFn);
    await Promise.all([
      client.versions('sparse+https://index.crates.io/', 'log'),
      client.versions('sparse+https://index.crates.io/', 'log'),
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('version selection', () => {
  const v = (version: string, extra: { yanked?: boolean; rustVersion?: string } = {}) => ({
    version,
    yanked: false,
    rustVersion: undefined as string | undefined,
    ...extra,
  });
  const all = [v('1.0.0'), v('1.1.0'), v('1.2.0', { yanked: true }), v('2.0.0-rc.1'), v('1.1.5', { rustVersion: '1.80' })];

  it('CREQ-07 stable channel skips yanked and pre-releases', () => {
    expect(selectVersion(all, { channel: 'stable' }).version).toBe('1.1.5');
  });

  it('CREQ-12 the all channel includes pre-releases but never yanked versions', () => {
    expect(selectVersion(all, { channel: 'all' }).version).toBe('2.0.0-rc.1');
  });

  it('CREQ-08 a version needing a newer rustc than the declared MSRV is passed over and reported', () => {
    const result = selectVersion(all, { channel: 'stable', rustVersion: '1.70' });
    expect(result.version).toBe('1.1.0');
    expect(result.blockedByMsrv).toEqual({ version: '1.1.5', requires: '1.80' });
  });

  it('CREQ-09 returns undefined when nothing qualifies', () => {
    expect(selectVersion([v('1.0.0', { yanked: true })], { channel: 'stable' }).version).toBeUndefined();
  });
});
