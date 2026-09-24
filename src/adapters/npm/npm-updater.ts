import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { DependencyUpdaterPort } from '../../domain/ports.js';
import type { ProjectModule, UpdateCandidate, UpdateSummary } from '../../domain/models.js';

const execAsync = promisify(exec);

export class NpmUpdaterAdapter implements DependencyUpdaterPort {
  async applyUpdates(
    module: ProjectModule,
    rootDir: string,
    updates: UpdateCandidate[],
    onProgress: (stepMessage: string) => void,
  ): Promise<Pick<UpdateSummary, 'updatedCount' | 'auditMessage' | 'auditSeverity' | 'fundingMessage'>> {
    const pkgPath = join(module.path, 'package.json');
    let pkg: any;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    } catch {
      throw new Error(`Konnte package.json in ${module.path} nicht lesen.`);
    }

    onProgress('Schreibe neue Versionen in package.json…');
    for (const item of updates) {
      const name = item.coordinate.artifact;
      if (pkg.dependencies?.[name]) {
        pkg.dependencies[name] = item.newRange;
      }
      if (pkg.devDependencies?.[name]) {
        pkg.devDependencies[name] = item.newRange;
      }
    }
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

    onProgress('Führe npm install aus (bitte kurz warten)…');
    let stdout = '';
    let stderr = '';
    try {
      const res = await execAsync('npm install', { cwd: rootDir });
      stdout = res.stdout;
      stderr = res.stderr;
    } catch (err: any) {
      stdout = err.stdout ?? '';
      stderr = err.stderr ?? err.message;
    }

    onProgress('Analysiere Sicherheitsaudit & Output…');
    const combined = stdout + '\n' + stderr;
    const auditMatch = combined.match(/found (\d+ vulnerabilit(?:y|ies).*)/i);
    const fundingMatch = combined.match(/(\d+ packages? (?:is|are) looking for funding)/i);

    return {
      updatedCount: updates.length,
      auditMessage: auditMatch ? auditMatch[0] : 'Keine bekannten Schwachstellen gefunden.',
      auditSeverity: auditMatch ? 'warn' : 'clean',
      fundingMessage: fundingMatch ? fundingMatch[0] : undefined,
    };
  }
}
