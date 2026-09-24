import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ModuleDiscoveryPort } from '../../domain/ports.js';
import type { ProjectModule } from '../../domain/models.js';

function extractPomInfo(pomPath: string): { name: string; id: string } | null {
  try {
    const xml = readFileSync(pomPath, 'utf8');

    // Extract parent groupId as fallback
    const parentMatch = xml.match(/<parent>([\s\S]*?)<\/parent>/);
    let parentGroup = '';
    if (parentMatch) {
      const pg = parentMatch[1]!.match(/<groupId>([^<]+)<\/groupId>/);
      if (pg) parentGroup = pg[1]!.trim();
    }

    // Strip <parent>, <dependencies>, <build> to get project-level tags
    const strippedXml = xml
      .replace(/<parent>[\s\S]*?<\/parent>/, '')
      .replace(/<dependencies>[\s\S]*?<\/dependencies>/, '')
      .replace(/<build>[\s\S]*?<\/build>/, '');

    const artifactMatch = strippedXml.match(/<artifactId>([^<]+)<\/artifactId>/);
    const groupMatch = strippedXml.match(/<groupId>([^<]+)<\/groupId>/);
    const nameMatch = strippedXml.match(/<name>([^<]+)<\/name>/);

    const artifact = artifactMatch ? artifactMatch[1]!.trim() : 'unbekannt';
    const group = groupMatch ? groupMatch[1]!.trim() : parentGroup;
    const name = nameMatch ? nameMatch[1]!.trim() : artifact;

    return {
      name: name || artifact,
      id: group ? `${group}:${artifact}` : artifact,
    };
  } catch {
    return null;
  }
}

/** Rekursives Suchen nach pom.xml Dateien */
function findPomFiles(dir: string, depth: number = 0, maxDepth: number = 4): string[] {
  if (depth > maxDepth || !existsSync(dir)) return [];
  const results: string[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'target') {
        continue;
      }
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const pomPath = join(fullPath, 'pom.xml');
        if (existsSync(pomPath)) {
          results.push(pomPath);
        }
        results.push(...findPomFiles(fullPath, depth + 1, maxDepth));
      }
    }
  } catch {
    /* ignorieren bei Lesefehlern */
  }

  return results;
}

/** Adapter zur Entdeckung aller Maven-Projekte im Monorepo */
export class MavenModuleDiscoveryAdapter implements ModuleDiscoveryPort {
  async discover(rootDir: string): Promise<ProjectModule[]> {
    const pomFiles = findPomFiles(rootDir);
    const modules: ProjectModule[] = [];
    const seenPaths = new Set<string>();

    for (const pomPath of pomFiles) {
      const moduleDir = pomPath.slice(0, -'/pom.xml'.length);
      if (seenPaths.has(moduleDir)) continue;
      seenPaths.add(moduleDir);

      const info = extractPomInfo(pomPath);
      if (!info) continue;

      const relPath = relative(rootDir, moduleDir).replace(/\\/g, '/');

      modules.push({
        id: info.id,
        name: info.name,
        path: moduleDir,
        relPath: relPath || 'Root',
        ecosystem: 'maven',
        isRoot: moduleDir === rootDir,
      });
    }

    // Nach relativem Pfad sortieren
    modules.sort((a, b) => a.relPath.localeCompare(b.relPath));
    return modules;
  }
}
