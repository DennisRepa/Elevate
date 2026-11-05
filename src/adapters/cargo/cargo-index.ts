/**
 * Elevate — Cargo sparse index client.
 *
 * Reads one index file per crate over HTTP. It sends no credentials: a
 * registry that asks for authentication is reported as such instead of being
 * served, so Elevate never handles registry tokens.
 */

import { VERSION } from '../../version.js';

export interface IndexVersion {
  version: string;
  yanked: boolean;
  /** Minimum supported Rust version the crate declares. */
  rustVersion: string | undefined;
}

export class RegistryAuthRequiredError extends Error {
  constructor(readonly index: string) {
    super(`The registry ${index} requires authentication. Elevate does not handle registry credentials.`);
    this.name = 'RegistryAuthRequiredError';
  }
}

export class CrateNotFoundError extends Error {
  constructor(readonly crate: string, readonly index: string) {
    super(`'${crate}' is not in the registry ${index}.`);
    this.name = 'CrateNotFoundError';
  }
}

export class UnsupportedIndexError extends Error {
  constructor(readonly index: string) {
    super(`The registry index ${index} is not a sparse index; Elevate cannot read it.`);
    this.name = 'UnsupportedIndexError';
  }
}

const CRATES_IO_SPARSE = 'https://index.crates.io/';
const CRATES_IO_GIT = 'registry+https://github.com/rust-lang/crates.io-index';

/** Path of a crate's index file below the index root. */
export function indexPath(name: string): string {
  const n = name.toLowerCase();
  if (n.length <= 2) return `${n.length}/${n}`;
  if (n.length === 3) return `3/${n[0]}/${n}`;
  return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n}`;
}

export function parseIndex(text: string): IndexVersion[] {
  const versions: IndexVersion[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    try {
      const entry = JSON.parse(raw);
      if (typeof entry.vers !== 'string') continue;
      versions.push({ version: entry.vers, yanked: entry.yanked === true, rustVersion: entry.rust_version });
    } catch {
      // A line that is not JSON says nothing about the others.
    }
  }
  return versions;
}

/** Turns an index URL as Cargo prints it into the root of a sparse index. */
function sparseRoot(index: string): string {
  if (index === CRATES_IO_GIT) return CRATES_IO_SPARSE;
  if (index.startsWith('sparse+')) {
    const url = index.slice('sparse+'.length);
    return url.endsWith('/') ? url : `${url}/`;
  }
  throw new UnsupportedIndexError(index);
}

const userAgent = () => `elevate/${VERSION} (+https://github.com/DennisRepa/Elevate)`;

function networkReason(err: unknown): string {
  const cause = (err as { cause?: { message?: string } })?.cause?.message;
  return cause ?? (err instanceof Error ? err.message : String(err));
}

export class CargoIndexClient {
  private readonly memo = new Map<string, Promise<IndexVersion[]>>();

  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  /** All versions of a crate in oldest-first file order. Memoised per index and crate. */
  versions(index: string, crate: string): Promise<IndexVersion[]> {
    const key = `${index}\n${crate.toLowerCase()}`;
    let pending = this.memo.get(key);
    if (!pending) {
      pending = this.load(index, crate);
      this.memo.set(key, pending);
    }
    return pending;
  }

  private async load(index: string, crate: string): Promise<IndexVersion[]> {
    const url = `${sparseRoot(index)}${indexPath(crate)}`;
    let response: Response;
    try {
      response = await this.fetchFn(url, { headers: { 'user-agent': userAgent() } });
    } catch (err) {
      throw new Error(`Cannot reach ${url}: ${networkReason(err)}${this.proxyHint()}`);
    }
    if (response.status === 401 || response.status === 403) throw new RegistryAuthRequiredError(index);
    if (response.status === 404) throw new CrateNotFoundError(crate, index);
    if (!response.ok) throw new Error(`Registry answered ${response.status} for ${url}.`);
    return parseIndex(await response.text());
  }

  /**
   * Node's fetch ignores HTTP(S)_PROXY unless NODE_USE_ENV_PROXY=1 is set when
   * the process starts (measured with Node 22.23; it cannot be switched on later).
   */
  private proxyHint(): string {
    const proxied = this.env.HTTPS_PROXY || this.env.https_proxy || this.env.HTTP_PROXY || this.env.http_proxy;
    if (!proxied || this.env.NODE_USE_ENV_PROXY === '1') return '';
    return ' A proxy is configured, but Node does not use it for registry lookups unless you start Elevate with NODE_USE_ENV_PROXY=1.';
  }
}
