import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { VerificationPort } from '../../domain/ports.js';
import type { ProjectModule } from '../../domain/models.js';

const execAsync = promisify(exec);

export class NpmVerificationAdapter implements VerificationPort {
  async verify(
    module: ProjectModule,
    rootDir: string,
    customScript?: string,
    customLabel?: string,
  ): Promise<{ status: 'clean' | 'warn'; details: string; label: string }> {
    const script = customScript || 'npm run check:versions';
    const label = customLabel || 'Workspace-Konsistenz (npm run check:versions)';

    try {
      const { stdout } = await execAsync(script, { cwd: rootDir });
      return {
        status: 'clean',
        details: stdout.trim() || 'Alle Workspace-Versionen sind konsistent.',
        label,
      };
    } catch (err: any) {
      return {
        status: 'warn',
        details: err.stdout || err.message,
        label,
      };
    }
  }
}
