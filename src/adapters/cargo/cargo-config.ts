/**
 * Elevate — Cargo registry configuration.
 *
 * `cargo metadata` does not show source replacement, and `cargo config get`
 * is nightly-only, so the few settings that decide where a lookup goes are
 * read from the configuration files and environment directly.
 *
 * The reader is deliberately narrow and fails closed: a replacement it cannot
 * interpret (a vendored directory, a local registry, a git source) is refused.
 * Falling back to crates.io would bypass the mirror or air gap the project
 * was set up with.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { getStaticTOMLValue, parseTOML } from 'toml-eslint-parser';

const CRATES_IO = 'registry+https://github.com/rust-lang/crates.io-index';
const PUBLIC_HOSTS = new Set(['index.crates.io', 'static.crates.io', 'crates.io', 'github.com']);

export class UnsupportedSourceError extends Error {
  constructor(detail: string) {
    super(`Cargo is configured to use a package source Elevate cannot read (${detail}). No lookup was made.`);
    this.name = 'UnsupportedSourceError';
  }
}

type Table = Record<string, any>;

function isPublicIndex(index: string): boolean {
  try {
    const url = new URL(index.replace(/^(sparse|registry)\+/, ''));
    return PUBLIC_HOSTS.has(url.hostname.toLowerCase()) && (url.hostname !== 'github.com' || url.pathname.includes('crates.io-index'));
  } catch {
    return false;
  }
}

/** Overlays `top` onto `base` key by key. */
function merge(base: Table, top: Table): Table {
  const out: Table = { ...base };
  for (const [key, value] of Object.entries(top)) {
    const existing = out[key];
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value) && existing && typeof existing === 'object' && !Array.isArray(existing)
        ? merge(existing, value)
        : value;
  }
  return out;
}

function loadFile(file: string, depth = 0): Table {
  let table: Table;
  try {
    table = getStaticTOMLValue(parseTOML(readFileSync(file, 'utf8'))) as Table;
  } catch {
    return {};
  }
  const includes: unknown = table.include;
  delete table.include;
  if (!Array.isArray(includes) || depth > 4) return table;
  let included: Table = {};
  for (const entry of includes) {
    const path = typeof entry === 'string' ? entry : entry?.path;
    if (typeof path === 'string') included = merge(included, loadFile(isAbsolute(path) ? path : resolve(dirname(file), path), depth + 1));
  }
  return merge(included, table);
}

export class CargoConfigReader {
  private readonly env: NodeJS.ProcessEnv;
  private readonly cache = new Map<string, Table>();

  constructor(options: { env?: NodeJS.ProcessEnv } = {}) {
    this.env = options.env ?? process.env;
  }

  /** The configuration as Cargo would merge it for `cwd`: nearest file first, CARGO_HOME last. */
  private config(cwd: string): Table {
    const start = resolve(cwd);
    let cached = this.cache.get(start);
    if (cached) return cached;
    const files: string[] = [];
    for (let dir = start; ; ) {
      for (const name of ['config.toml', 'config']) {
        const file = join(dir, '.cargo', name);
        if (existsSync(file)) {
          files.push(file);
          break;
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    const home = this.env.CARGO_HOME ?? join(homedir(), '.cargo');
    for (const name of ['config.toml', 'config']) {
      const file = join(home, name);
      if (existsSync(file) && !files.includes(file)) {
        files.push(file);
        break;
      }
    }
    // Later entries have lower precedence, so apply them first.
    cached = files.reduceRight((acc, file) => merge(acc, loadFile(file)), {} as Table);
    this.cache.set(start, cached);
    return cached;
  }

  /** `[source.*]` comes from files only: Cargo ignores `CARGO_SOURCE_*` variables (checked with Cargo 1.97). */
  private sourceField(config: Table, source: string, field: string): string | undefined {
    const value = config.source?.[source]?.[field];
    return typeof value === 'string' ? value : undefined;
  }

  /**
   * The index a lookup goes to. `registry` is the index URL of an alternative
   * registry as Cargo reports it, or undefined for crates.io.
   */
  async resolve(registry: string | undefined, cwd: string): Promise<{ index: string; isPublic: boolean }> {
    const config = this.config(cwd);
    let name = registry === undefined ? 'crates-io' : this.sourceNamed(config, registry);
    let index = registry ?? CRATES_IO;
    const seen = new Set<string>();

    while (name !== undefined) {
      if (seen.has(name)) throw new UnsupportedSourceError(`replacement cycle at '${name}'`);
      seen.add(name);
      const next = this.sourceField(config, name, 'replace-with');
      if (next === undefined) break;
      for (const kind of ['directory', 'local-registry', 'git']) {
        if (this.sourceField(config, next, kind) !== undefined) throw new UnsupportedSourceError(`'${next}' is a ${kind} source`);
      }
      const target = this.sourceField(config, next, 'registry');
      if (target !== undefined) {
        index = target;
        name = next;
        // A source that is itself replaced continues the chain; one that is not ends it.
        if (this.sourceField(config, next, 'replace-with') === undefined) break;
        continue;
      }
      if (this.sourceField(config, next, 'replace-with') === undefined) {
        throw new UnsupportedSourceError(`'${next}' has no registry`);
      }
      name = next;
    }
    return { index, isPublic: isPublicIndex(index) };
  }

  /** Name of the `[source.*]` table whose registry is `url`, if any. */
  private sourceNamed(config: Table, url: string): string | undefined {
    return Object.keys(config.source ?? {}).find((n) => this.sourceField(config, n, 'registry') === url);
  }
}
