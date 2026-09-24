import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import semver from 'semver';
import type { RegistryPort } from '../../domain/ports.js';
import type { DependencyCoordinate, ReleaseChannel } from '../../domain/models.js';

const execAsync = promisify(exec);

export class NpmRegistryAdapter implements RegistryPort {
  async getLatestVersion(
    coordinate: DependencyCoordinate,
    channel: ReleaseChannel = 'stable',
  ): Promise<string | null> {
    try {
      if (channel === 'stable') {
        // Fragt explizit das "latest" dist-tag ab (das standardmäßig für stabile Releases steht)
        const { stdout } = await execAsync(
          `npm view ${coordinate.identifier} "dist-tags.latest" --json`,
          { timeout: 15_000 },
        );
        const v = stdout.trim().replace(/^"|"$/g, '');
        if (v && semver.valid(v) && semver.prerelease(v) === null) {
          return v;
        }
      }

      // Fallback oder channel === 'all'
      const { stdout } = await execAsync(
        `npm view ${coordinate.identifier} version --json`,
        { timeout: 15_000 },
      );
      return stdout.trim().replace(/^"|"$/g, '');
    } catch {
      return null;
    }
  }

  /** Liefert alle veröffentlichten Versionen (neueste zuerst) */
  async getAllVersions(coordinate: DependencyCoordinate): Promise<string[]> {
    try {
      const { stdout } = await execAsync(
        `npm view ${coordinate.identifier} versions --json`,
        { timeout: 15_000 },
      );
      const parsed = JSON.parse(stdout.trim());
      const list: string[] = Array.isArray(parsed) ? parsed : [parsed];
      return list.map(String).reverse();
    } catch {
      return [];
    }
  }
}
