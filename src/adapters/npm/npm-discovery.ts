/**
 * Elevate — npm workspace discovery.
 *
 * Resolves the `workspaces` patterns of the root package.json with
 * `@npmcli/map-workspaces`, the same library npm uses internally. Glob
 * patterns (`packages/**`, `apps/*-service`), negations and nested folders
 * therefore behave exactly as they do for `npm install`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import mapWorkspaces from '@npmcli/map-workspaces';
import type { ModuleDiscoveryPort } from '../../domain/ports.js';
import type { ProjectModule } from '../../domain/models.js';

function readJson(filePath: string): any {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export class NpmModuleDiscoveryAdapter implements ModuleDiscoveryPort {
  /**
   * The nearest directory, from `startDir` upwards to the boundary, whose
   * package.json is valid JSON and declares `workspaces`.
   */
  findRoot(startDir: string, boundaryDir: string | undefined): string | undefined {
    let dir = resolve(startDir);
    const boundary = boundaryDir ? resolve(boundaryDir) : undefined;
    for (;;) {
      if (readJson(join(dir, 'package.json'))?.workspaces) return dir;
      const parent = dirname(dir);
      if (dir === boundary || parent === dir) return undefined;
      dir = parent;
    }
  }

  async discover(rootDir: string): Promise<ProjectModule[]> {
    const rootPkg = readJson(join(rootDir, 'package.json'));

    const modules: ProjectModule[] = [
      {
        id: rootPkg?.name ?? 'root',
        name: rootPkg?.name ?? 'Root Workspace (npm)',
        path: rootDir,
        relPath: 'Root',
        ecosystem: 'npm',
        isRoot: true,
        version: typeof rootPkg?.version === 'string' ? rootPkg.version : undefined,
      },
    ];

    if (!rootPkg?.workspaces) return modules;

    let workspaces: Map<string, string>;
    try {
      workspaces = await mapWorkspaces({ cwd: rootDir, pkg: rootPkg });
    } catch {
      // Invalid workspace configuration (e.g. duplicate names): npm refuses it
      // as well, so only the root is reported.
      return modules;
    }

    for (const [name, path] of workspaces) {
      const pkg = readJson(join(path, 'package.json'));
      modules.push({
        id: name,
        name,
        path,
        relPath: relative(rootDir, path).replace(/\\/g, '/'),
        ecosystem: 'npm',
        isRoot: false,
        version: typeof pkg?.version === 'string' ? pkg.version : undefined,
      });
    }

    modules.sort((a, b) => (a.isRoot ? -1 : b.isRoot ? 1 : a.relPath.localeCompare(b.relPath)));
    return modules;
  }
}
