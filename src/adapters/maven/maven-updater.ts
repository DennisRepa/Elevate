import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { DependencyUpdaterPort } from '../../domain/ports.js';
import type { ProjectModule, UpdateCandidate, UpdateSummary } from '../../domain/models.js';

const execAsync = promisify(exec);

export class MavenUpdaterAdapter implements DependencyUpdaterPort {
  async applyUpdates(
    module: ProjectModule,
    _rootDir: string,
    updates: UpdateCandidate[],
    onProgress: (stepMessage: string) => void,
  ): Promise<Pick<UpdateSummary, 'updatedCount' | 'auditMessage' | 'auditSeverity' | 'fundingMessage'>> {
    const pomPath = join(module.path, 'pom.xml');
    let xml = '';
    try {
      xml = readFileSync(pomPath, 'utf8');
    } catch {
      throw new Error(`Konnte pom.xml in ${module.path} nicht lesen.`);
    }

    onProgress('Schreibe neue Versionen in pom.xml…');

    for (const item of updates) {
      const group = item.coordinate.group;
      const artifact = item.coordinate.artifact;
      const newVersion = item.newRange;

      if (!group || !artifact) continue;

      // Ersetze <version> im passenden <dependency>-Block
      const depRegex = new RegExp(
        `(<dependency>[\\s\\S]*?<groupId>${group}<\\/groupId>[\\s\\S]*?<artifactId>${artifact}<\\/artifactId>[\\s\\S]*?<version>)([^<]+)(<\\/version>[\\s\\S]*?<\\/dependency>)`,
        'g'
      );

      xml = xml.replace(depRegex, `$1${newVersion}$3`);
    }

    writeFileSync(pomPath, xml, 'utf8');

    onProgress('Löse neue Maven-Abhängigkeiten auf (mvn dependency:resolve)…');
    let stdout = '';
    let stderr = '';
    try {
      const res = await execAsync('mvn dependency:resolve -q -DskipTests', {
        cwd: module.path,
        timeout: 60_000,
      });
      stdout = res.stdout;
      stderr = res.stderr;
    } catch (err: any) {
      stdout = err.stdout ?? '';
      stderr = err.stderr ?? err.message;
    }

    onProgress('Analysiere Maven-Status…');
    const hasError = stdout.includes('BUILD FAILURE') || stderr.includes('BUILD FAILURE');

    return {
      updatedCount: updates.length,
      auditMessage: hasError
        ? 'Achtung: Einige Abhängigkeiten konnten nicht sofort aufgelöst werden.'
        : 'Alle Maven-Abhängigkeiten erfolgreich aufgelöst.',
      auditSeverity: hasError ? 'warn' : 'clean',
      fundingMessage: undefined,
    };
  }
}
