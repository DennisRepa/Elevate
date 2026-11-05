/**
 * Elevate — Cargo workspace discovery.
 *
 * Finds every `Cargo.toml` in the repository (not only at the root, so a Rust
 * crate beside a JavaScript app is found) and lets Cargo itself report the
 * workspace members: one `cargo metadata` run per workspace.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { ModuleDiscoveryPort } from '../../domain/ports.js';
import type { ProjectModule } from '../../domain/models.js';
import { CargoUnavailableError } from './cargo-command.js';
import { CargoMetadataError, loadMetadata } from './cargo-metadata.js';

/** Directories that never hold modules. A manifest below `src` is a test fixture or template. */
const IGNORED = new Set(['target', 'node_modules', 'vendor', 'dist', 'build', 'out', 'src']);

const norm = (path: string) => resolve(path).replace(/\\/g, '/');

function findManifests(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === 'Cargo.toml')) found.push(join(dir, 'Cargo.toml'));
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !IGNORED.has(entry.name)) walk(join(dir, entry.name), depth + 1);
    }
  };
  walk(root, 0);
  // Shallowest first, so a workspace root is read before the crates inside it.
  return found.sort((a, b) => a.split(/[\\/]/).length - b.split(/[\\/]/).length || a.localeCompare(b));
}

const declaresWorkspace = (dir: string) => {
  try {
    return /^\s*\[workspace[\].]/m.test(readFileSync(join(dir, 'Cargo.toml'), 'utf8'));
  } catch {
    return false;
  }
};

export class CargoModuleDiscoveryAdapter implements ModuleDiscoveryPort {
  private problems: string[] = [];

  diagnostics(): string[] {
    return [...this.problems];
  }

  /** The nearest ancestor declaring `[workspace]`; failing that, the nearest directory with a manifest. */
  findRoot(startDir: string, boundaryDir: string | undefined): string | undefined {
    const boundary = boundaryDir ? resolve(boundaryDir) : undefined;
    const chain: string[] = [];
    for (let dir = resolve(startDir); ; ) {
      chain.push(dir);
      const parent = dirname(dir);
      if (dir === boundary || parent === dir) break;
      dir = parent;
    }
    return chain.find(declaresWorkspace) ?? chain.find((d) => existsSync(join(d, 'Cargo.toml')));
  }

  async discover(rootDir: string): Promise<ProjectModule[]> {
    const covered = new Set<string>();
    const modules: ProjectModule[] = [];
    const errors: CargoMetadataError[] = [];
    this.problems = [];

    for (const manifest of findManifests(rootDir)) {
      if (covered.has(norm(manifest))) continue;
      try {
        const metadata = await loadMetadata(dirname(manifest));
        for (const pkg of metadata.packages) {
          covered.add(norm(pkg.manifest_path));
          const path = dirname(pkg.manifest_path);
          const relPath = relative(rootDir, path).replace(/\\/g, '/');
          modules.push({
            id: pkg.name,
            name: pkg.name,
            path,
            relPath: relPath === '' ? 'Root' : relPath,
            ecosystem: 'cargo',
            isRoot: relPath === '',
            version: pkg.version,
            aggregatorDir: metadata.workspace_root,
          });
        }
      } catch (err) {
        if (err instanceof CargoUnavailableError) throw err;
        if (err instanceof CargoMetadataError) {
          errors.push(err);
          this.problems.push(err.message);
        }
        else throw err;
      }
    }

    // Failures are only fatal when they leave nothing to show.
    if (modules.length === 0 && errors.length > 0) throw errors[0]!;
    modules.sort((a, b) => (a.isRoot ? -1 : b.isRoot ? 1 : a.relPath.localeCompare(b.relPath)));

    // Independent workspaces may each hold a crate of the same name; ids must stay unique.
    const taken = new Set<string>();
    for (const module of modules) {
      if (taken.has(module.id)) module.id = `${module.name} (${module.relPath})`;
      taken.add(module.id);
    }
    return modules;
  }
}
