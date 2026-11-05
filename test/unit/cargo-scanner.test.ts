import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { CargoDependencyAdapter } from '../../src/adapters/cargo/cargo-scanner.js';
import { CrateNotFoundError, RegistryAuthRequiredError } from '../../src/adapters/cargo/cargo-index.js';
import type { CargoMetadata, MetadataDependency } from '../../src/adapters/cargo/cargo-metadata.js';
import type { IndexVersion } from '../../src/adapters/cargo/cargo-index.js';
import { buildWorkspaceIndex } from '../../src/domain/origin.js';
import type { ProjectModule } from '../../src/domain/models.js';
import type { ScanContext } from '../../src/domain/ports.js';
import { cleanupTemp, makeTree } from '../helpers.js';

afterEach(cleanupTemp);

const CRATES = 'registry+https://github.com/rust-lang/crates.io-index';
const CORP = 'sparse+https://corp.example/index/';

const dep = (name: string, req: string, extra: Partial<MetadataDependency> = {}): MetadataDependency => ({
  name,
  req,
  kind: null,
  rename: null,
  source: CRATES,
  target: null,
  optional: false,
  ...extra,
});
const v = (version: string, extra: Partial<IndexVersion> = {}): IndexVersion => ({ version, yanked: false, rustVersion: undefined, ...extra });

interface Setup {
  manifests: Record<string, string>;
  deps: MetadataDependency[];
  index?: Record<string, IndexVersion[] | Error>;
  otherMembers?: { name: string; manifest: string; version?: string }[];
  rustVersion?: string;
  scopes?: string[];
  endpoint?: (registry: string | undefined) => { index: string; isPublic: boolean };
  channel?: 'stable' | 'all';
}

async function scan(setup: Setup) {
  const root = makeTree({ 'Cargo.toml': '[workspace]\nmembers=["a"]\n', 'a/Cargo.toml': '', ...setup.manifests });
  const others = setup.otherMembers ?? [];
  const files: Record<string, string> = {};
  for (const o of others) files[`${o.name}/Cargo.toml`] = o.manifest;
  const extra = makeTree(files);
  const aDir = join(root, 'a');
  const deps = setup.deps.map((d) => (d.path?.startsWith('PEER:') ? { ...d, path: join(extra, d.path.slice(5)) } : d));
  const metadata: CargoMetadata = {
    workspace_root: root,
    packages: [
      { name: 'a', version: '0.3.0', manifest_path: join(aDir, 'Cargo.toml'), rust_version: setup.rustVersion ?? null, dependencies: deps },
      ...others.map((o) => ({ name: o.name, version: o.version ?? '0.1.0', manifest_path: join(extra, o.name, 'Cargo.toml'), rust_version: null, dependencies: [] })),
    ],
  };
  const module: ProjectModule = { id: 'a', name: 'a', path: aDir, relPath: 'a', ecosystem: 'cargo', isRoot: false, version: '0.3.0', aggregatorDir: root };
  const peers: ProjectModule[] = others.map((o) => ({ id: o.name, name: o.name, path: join(extra, o.name), relPath: o.name, ecosystem: 'cargo', isRoot: false, version: o.version }));
  const lookups: string[] = [];
  const adapter = new CargoDependencyAdapter({
    loadMetadata: async () => metadata,
    index: {
      versions: async (index: string, crate: string) => {
        lookups.push(`${index}|${crate}`);
        const r = setup.index?.[crate];
        if (r instanceof Error) throw r;
        if (!r) throw new CrateNotFoundError(crate, index);
        return r;
      },
    },
    endpoint: async (registry) => (setup.endpoint ?? ((r) => ({ index: r ?? CRATES, isPublic: !r })))(registry),
  });
  const context: ScanContext = {
    rootDir: root,
    workspace: buildWorkspaceIndex([module, ...peers]),
    internalScopes: setup.scopes ?? [],
    channel: setup.channel ?? 'stable',
  };
  const result = await adapter.scan(module, context);
  return { ...result, lookups, root, aDir };
}

describe('Cargo dependency scanner', () => {
  it('CSCAN-01 a fully specified requirement is raised to the latest release', async () => {
    const r = await scan({ manifests: { 'a/Cargo.toml': '[dependencies]\nlog = "0.4.10"\n' }, deps: [dep('log', '^0.4.10')], index: { log: [v('0.4.10'), v('0.4.35')] } });
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({
      coordinate: { identifier: 'log', ecosystem: 'cargo' },
      currentRange: '0.4.10',
      currentClean: '0.4.10',
      latest: '0.4.35',
      newRange: '0.4.35',
      diff: 'minor',
      scope: 'prod',
      selected: true,
      action: 'update',
      origin: { kind: 'public' },
      declaration: { kind: 'dependency', displayPath: 'a/Cargo.toml' },
    });
  });

  it('CSCAN-02 a loose requirement only shows breaking updates, which are not preselected', async () => {
    const manifests = { 'a/Cargo.toml': '[dependencies]\nitoa = "1"\nrand = "0.8"\n' };
    const deps = [dep('itoa', '^1'), dep('rand', '^0.8')];
    const none = await scan({ manifests, deps: [deps[0]!], index: { itoa: [v('1.0.18')] } });
    expect(none.candidates).toEqual([]);
    const major = await scan({ manifests, deps, index: { itoa: [v('2.1.0')], rand: [v('0.8.5'), v('0.9.2')] } });
    expect(major.candidates.map((c) => [c.coordinate.identifier, c.newRange, c.diff, c.selected])).toEqual([
      ['itoa', '2', 'major', false],
      ['rand', '0.9', 'major', false],
    ]);
  });

  it('CSCAN-03 dev, build and target dependencies are scoped and annotated', async () => {
    const r = await scan({
      manifests: {
        'a/Cargo.toml':
          '[dev-dependencies]\ntempfile = "3.0.0"\n[build-dependencies]\ncc = "1.0.0"\n[target.\'cfg(unix)\'.dependencies]\nlibc = "0.2.100"\n',
      },
      deps: [dep('tempfile', '^3.0.0', { kind: 'dev' }), dep('cc', '^1.0.0', { kind: 'build' }), dep('libc', '^0.2.100', { target: 'cfg(unix)' })],
      index: { tempfile: [v('3.20.0')], cc: [v('1.2.0')], libc: [v('0.2.150')] },
    });
    const by = Object.fromEntries(r.candidates.map((c) => [c.coordinate.identifier, c]));
    expect([by.tempfile!.scope, by.tempfile!.qualifier]).toEqual(['dev', undefined]);
    expect([by.cc!.scope, by.cc!.qualifier]).toEqual(['prod', 'build']);
    expect([by.libc!.scope, by.libc!.qualifier]).toEqual(['prod', 'cfg(unix)']);
  });

  it('CDECL-09 an inherited dependency points at the workspace root and names who else shares it', async () => {
    const r = await scan({
      manifests: {
        'Cargo.toml': '[workspace]\nmembers=["a","b"]\n[workspace.dependencies]\nserde = { version = "1.0.100", features = ["derive"] }\n',
        'a/Cargo.toml': '[dependencies]\nserde = { workspace = true }\n',
      },
      otherMembers: [{ name: 'b', manifest: '[dependencies]\nserde.workspace = true\n' }],
      deps: [dep('serde', '^1.0.100')],
      index: { serde: [v('1.0.229')] },
    });
    expect(r.candidates[0]).toMatchObject({
      currentRange: '1.0.100',
      newRange: '1.0.229',
      declaration: { kind: 'dependency-management', displayPath: 'Cargo.toml', file: join(r.root, 'Cargo.toml') },
      sharedWith: ['b'],
    });
  });

  it('CDECL-12 a renamed dependency is found under its rename and offered under the crate name', async () => {
    const r = await scan({
      manifests: { 'a/Cargo.toml': '[dependencies]\nsj = { package = "serde_json", version = "1.0.0" }\n' },
      deps: [dep('serde_json', '^1.0.0', { rename: 'sj' })],
      index: { serde_json: [v('1.0.140')] },
    });
    expect(r.candidates[0]).toMatchObject({ coordinate: { identifier: 'serde_json' }, newRange: '1.0.140' });
    expect(r.lookups[0]).toMatch(/\|serde_json$/);
  });

  it('CDECL-11 a literal that disagrees with cargo is reported, not edited', async () => {
    const r = await scan({ manifests: { 'a/Cargo.toml': '[dependencies]\nlog = "0.3.0"\n' }, deps: [dep('log', '^0.4.10')], index: { log: [v('0.4.35')] } });
    expect(r.candidates).toEqual([]);
    expect(r.skipped).toEqual([expect.objectContaining({ identifier: 'log', reason: 'declaration-mismatch' })]);
  });

  it('CREQ-11 wildcard requirements and git dependencies are left alone', async () => {
    const r = await scan({
      manifests: { 'a/Cargo.toml': '[dependencies]\nany = "*"\ngitdep = { git = "https://example.invalid/x.git" }\n' },
      deps: [dep('any', '*'), dep('gitdep', '*', { source: 'git+https://example.invalid/x.git' })],
      index: { any: [v('9.0.0')] },
    });
    expect(r.candidates).toEqual([]);
    expect(r.lookups).toEqual([]);
  });

  it('CALIGN-01 a path dependency whose version excludes the local version is aligned, keeping precision', async () => {
    const r = await scan({
      manifests: { 'a/Cargo.toml': '[dependencies]\nb = { path = "../b", version = "0.1" }\n' },
      otherMembers: [{ name: 'b', manifest: '', version: '0.2.0' }],
      deps: [dep('b', '^0.1', { source: null, path: 'PEER:b' })],
    });
    expect(r.lookups).toEqual([]);
    expect(r.candidates[0]).toMatchObject({ action: 'align', origin: { kind: 'workspace' }, currentRange: '0.1', newRange: '0.2', latest: '0.2.0' });
  });

  it('CALIGN-02 a path dependency that already matches needs nothing', async () => {
    const r = await scan({
      manifests: { 'a/Cargo.toml': '[dependencies]\nb = { path = "../b", version = "0.2" }\n' },
      otherMembers: [{ name: 'b', manifest: '', version: '0.2.5' }],
      deps: [dep('b', '^0.2', { source: null, path: 'PEER:b' })],
    });
    expect(r.candidates).toEqual([]);
  });

  it('CREG-03 a crate from an alternative registry is looked up there and nowhere else', async () => {
    const r = await scan({
      manifests: { 'a/Cargo.toml': '[dependencies]\nsecret = { version = "1.0.0", registry = "corp" }\n' },
      deps: [dep('secret', '^1.0.0', { source: CORP, registry: CORP })],
      index: { secret: [v('1.4.0')] },
      endpoint: (reg) => ({ index: reg ?? CRATES, isPublic: false }),
    });
    expect(r.lookups).toEqual([`${CORP}|secret`]);
    expect(r.candidates[0]).toMatchObject({ origin: { kind: 'private', matchedBy: 'scoped-registry', registry: CORP }, coordinate: { registry: CORP } });
  });

  it('CREG-04 an internal name that would be resolved on a public registry is not looked up', async () => {
    const r = await scan({
      manifests: { 'a/Cargo.toml': '[dependencies]\nacme-core = "1.0.0"\n' },
      deps: [dep('acme-core', '^1.0.0')],
      index: { 'acme-core': [v('1.5.0')] },
      scopes: ['acme-*'],
    });
    expect(r.lookups).toEqual([]);
    expect(r.skipped).toEqual([expect.objectContaining({ identifier: 'acme-core', origin: 'private', reason: 'private-on-public-registry' })]);
  });

  it('CREG-14 a registry that wants authentication is reported as a failed lookup', async () => {
    const r = await scan({
      manifests: { 'a/Cargo.toml': '[dependencies]\nlog = "0.4.10"\n' },
      deps: [dep('log', '^0.4.10')],
      index: { log: new RegistryAuthRequiredError(CORP) },
    });
    expect(r.skipped).toEqual([expect.objectContaining({ identifier: 'log', reason: 'lookup-failed', detail: expect.stringMatching(/authentication/) })]);
  });

  it('CREQ-14 a release that needs a newer Rust than the project declares is reported', async () => {
    const r = await scan({
      manifests: { 'a/Cargo.toml': '[dependencies]\nlog = "0.4.10"\n' },
      deps: [dep('log', '^0.4.10')],
      index: { log: [v('0.4.10'), v('0.4.35', { rustVersion: '1.80' })] },
      rustVersion: '1.70',
    });
    expect(r.candidates).toEqual([]);
    expect(r.skipped).toEqual([expect.objectContaining({ identifier: 'log', reason: 'incompatible-rust-version' })]);
  });

  it('CREQ-13 pre-releases are offered only on the all channel', async () => {
    const manifests = { 'a/Cargo.toml': '[dependencies]\nlog = "0.4.10"\n' };
    const index = { log: [v('0.4.10'), v('0.5.0-rc.1')] };
    expect((await scan({ manifests, deps: [dep('log', '^0.4.10')], index })).candidates).toEqual([]);
    const all = await scan({ manifests, deps: [dep('log', '^0.4.10')], index, channel: 'all' });
    expect(all.candidates[0]).toMatchObject({ newRange: '0.5.0-rc.1', isPreRelease: true });
  });

  it('CDECL-13 a crate declared twice with different requirements gets one candidate and a note about the other', async () => {
    const r = await scan({
      manifests: { 'a/Cargo.toml': '[dependencies]\ntokio = "1.0.0"\n[dev-dependencies]\ntokio = "1.2.0"\n' },
      deps: [dep('tokio', '^1.0.0'), dep('tokio', '^1.2.0', { kind: 'dev' })],
      index: { tokio: [v('1.40.0')] },
    });
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ currentRange: '1.0.0', newRange: '1.40.0', scope: 'prod' });
    expect(r.skipped).toEqual([expect.objectContaining({ identifier: 'tokio', reason: 'declaration-mismatch', detail: expect.stringContaining('dev-dependencies requires ^1.2.0') })]);
  });

  it('CDECL-14 identical requirements in two sections need no note', async () => {
    const r = await scan({
      manifests: { 'a/Cargo.toml': '[dependencies]\ntokio = "1.0.0"\n[dev-dependencies]\ntokio = "1.0.0"\n' },
      deps: [dep('tokio', '^1.0.0'), dep('tokio', '^1.0.0', { kind: 'dev' })],
      index: { tokio: [v('1.40.0')] },
    });
    expect(r.skipped).toEqual([]);
  });

  it('CORIG-01 a path dependency elsewhere that merely shares a member\'s name is not aligned to that member', async () => {
    const r = await scan({
      manifests: { 'a/Cargo.toml': '[dependencies]\nb = { path = "../../elsewhere/b", version = "0.1" }\n' },
      otherMembers: [{ name: 'b', manifest: '', version: '0.2.0' }],
      deps: [dep('b', '^0.1', { source: null, path: '/elsewhere/b' })],
    });
    expect(r.candidates).toEqual([]);
  });

  it('CORIG-02 a registry crate named like a member is looked up as a crate, not aligned', async () => {
    const r = await scan({
      manifests: { 'a/Cargo.toml': '[dependencies]\nb = "0.1.0"\n' },
      otherMembers: [{ name: 'b', manifest: '', version: '0.2.0' }],
      deps: [dep('b', '^0.1.0')],
      index: { b: [v('0.1.0'), v('0.1.5')] },
    });
    expect(r.candidates[0]).toMatchObject({ action: 'update', origin: { kind: 'public' }, newRange: '0.1.5' });
  });
});
