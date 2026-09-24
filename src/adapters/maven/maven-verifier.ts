import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { VerificationPort } from '../../domain/ports.js';
import type { ProjectModule } from '../../domain/models.js';

const execAsync = promisify(exec);

export class MavenVerificationAdapter implements VerificationPort {
  async verify(
    module: ProjectModule,
    _rootDir: string,
    customScript?: string,
    customLabel?: string,
  ): Promise<{ status: 'clean' | 'warn'; details: string; label: string }> {
    const script = customScript || 'mvn test-compile -q';
    const label = customLabel || 'Java-Kompilierungstest (mvn test-compile)';

    try {
      const { stdout } = await execAsync(script, {
        cwd: module.path,
        timeout: 90_000,
      });

      return {
        status: 'clean',
        details: stdout.trim() || 'Java-Quellcode kompiliert fehlerfrei.',
        label,
      };
    } catch (err: any) {
      return {
        status: 'warn',
        details: (err.stdout || err.stderr || err.message).slice(0, 300),
        label,
      };
    }
  }
}
