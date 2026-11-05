import { describe, expect, it } from 'vitest';
import { parseCargoManifest } from '../../src/adapters/cargo/cargo-toml.js';
import { applyRangeEdits } from '../../src/adapters/shared/text-edit.js';
import { StaleEditError } from '../../src/adapters/shared/xml.js';

const FORMS = `# header comment
[package]
name = "demo"
version = "0.1.0"

[dependencies]
plain = "1.2.3"         # trailing comment
single = '0.4.10'
inline = { version = "1.0.100", features = ["derive"], default-features = false }
dotted.version = "2.0"
dotted.features = ["x"]
inherit = { workspace = true }
inherit2.workspace = true
renamed = { package = "serde_json", version = "1.0.0" }
pathv = { path = "../p", version = "0.1.0" }
gitdep = { git = "https://example.invalid/x.git" }

[dependencies.tabled]
version = "3.1"
features = ["a"]

[dev-dependencies]
tmp = "3"

[dev_dependencies]
legacy = "4"

[target.'cfg(unix)'.dependencies]
libc = "0.2.100"

[target."cfg(windows)".build-dependencies]
winapi = { version = "0.3.0", optional = true }

[workspace.dependencies]
wsdep = { version = "1.0.100", features = ["derive"] }
wsplain = "0.8.0"
`;

function find(key: string, where: { section?: string; target?: string; workspace?: boolean } = {}) {
  return parseCargoManifest(FORMS).find(
    (d) =>
      d.key === key &&
      (where.section === undefined || d.section === where.section) &&
      d.target === where.target &&
      d.inWorkspace === (where.workspace ?? false),
  );
}

describe('Cargo.toml dependency declarations', () => {
  it.each([
    ['plain', '1.2.3'],
    ['single', '0.4.10'],
    ['inline', '1.0.100'],
    ['dotted', '2.0'],
    ['renamed', '1.0.0'],
    ['pathv', '0.1.0'],
    ['tabled', '3.1'],
  ])('CDECL-01 finds the version literal of %s', (key, version) => {
    const decl = find(key);
    expect(decl?.version?.value).toBe(version);
    expect(FORMS.slice(decl!.version!.start, decl!.version!.end)).toBe(version);
  });

  it('CDECL-02 knows section and target', () => {
    expect(find('tmp')?.section).toBe('dev-dependencies');
    expect(find('legacy')?.section).toBe('dev-dependencies');
    expect(find('libc', { target: 'cfg(unix)' })?.section).toBe('dependencies');
    expect(find('winapi', { target: 'cfg(windows)' })?.section).toBe('build-dependencies');
  });

  it('CDECL-03 inherited dependencies have no local literal', () => {
    for (const key of ['inherit', 'inherit2']) {
      const decl = find(key);
      expect(decl?.inherited).toBe(true);
      expect(decl?.version).toBeUndefined();
    }
  });

  it('CDECL-04 workspace.dependencies are declarations of their own', () => {
    expect(find('wsdep', { workspace: true })?.version?.value).toBe('1.0.100');
    expect(find('wsplain', { workspace: true })?.version?.value).toBe('0.8.0');
  });

  it('CDECL-05 a dependency without a version has no literal', () => {
    expect(find('gitdep')?.version).toBeUndefined();
  });

  it('CUPD-01 an edit changes only the version text', () => {
    const decls = ['plain', 'single', 'inline', 'dotted', 'tabled'].map((k) => find(k)!);
    const edits = decls.map((d) => ({
      start: d.version!.start,
      end: d.version!.end,
      expected: d.version!.value,
      replacement: '9.9.9',
    }));
    const result = applyRangeEdits(FORMS, edits);
    expect(result).toBe(
      FORMS.replace('plain = "1.2.3"', 'plain = "9.9.9"')
        .replace("single = '0.4.10'", "single = '9.9.9'")
        .replace('version = "1.0.100", features = ["derive"], default', 'version = "9.9.9", features = ["derive"], default')
        .replace('dotted.version = "2.0"', 'dotted.version = "9.9.9"')
        .replace('version = "3.1"', 'version = "9.9.9"'),
    );
  });

  it('CUPD-11 CRLF files keep their line endings', () => {
    const source = '[dependencies]\r\nfoo = "1.0.0" # c\r\n';
    const decl = parseCargoManifest(source)[0]!;
    const result = applyRangeEdits(source, [
      { start: decl.version!.start, end: decl.version!.end, expected: '1.0.0', replacement: '1.0.5' },
    ]);
    expect(result).toBe('[dependencies]\r\nfoo = "1.0.5" # c\r\n');
  });

  it('CUPD-12 a stale literal is refused', () => {
    const decl = find('plain')!;
    expect(() =>
      applyRangeEdits(FORMS, [
        { start: decl.version!.start, end: decl.version!.end, expected: '0.0.1', replacement: '2.0.0' },
      ]),
    ).toThrow(StaleEditError);
  });
});
