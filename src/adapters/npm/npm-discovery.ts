import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ModuleDiscoveryPort } from '../../domain/ports.js';
import type { ProjectModule } from '../../domain/models.js';

function readJson(filePath: string): any {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/** Adapter zur Erkennung von npm Workspaces anhand der Root package.json */
export class NpmModuleDiscoveryAdapter implements ModuleDiscoveryPort {
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
      },
    ];

    if (!rootPkg?.workspaces) return modules;

    const patterns: string[] = Array.isArray(rootPkg.workspaces)
      ? rootPkg.workspaces
      : [];

    for (const pattern of patterns) {
      if (pattern.endsWith('/*')) {
        const parentDir = join(rootDir, pattern.slice(0, -2));
        if (!existsSync(parentDir)) continue;

        for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const pkgPath = join(parentDir, entry.name, 'package.json');
          if (!existsSync(pkgPath)) continue;

          const pkg = readJson(pkgPath);
          modules.push({
            id: pkg?.name ?? `${pattern.slice(0, -2)}/${entry.name}`,
            name: pkg?.name ?? `${pattern.slice(0, -2)}/${entry.name}`,
            path: join(parentDir, entry.name),
            relPath: `${pattern.slice(0, -2)}/${entry.name}`,
            ecosystem: 'npm',
            isRoot: false,
          });
        }
      } else {
        const explicitPath = join(rootDir, pattern);
        const pkgPath = join(explicitPath, 'package.json');
        if (!existsSync(pkgPath)) continue;

        const pkg = readJson(pkgPath);
        modules.push({
          id: pkg?.name ?? pattern,
          name: pkg?.name ?? pattern,
          path: explicitPath,
          relPath: pattern,
          ecosystem: 'npm',
          isRoot: false,
        });
      }
    }

    return modules;
  }
}
