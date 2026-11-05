/**
 * Elevate — package manager commands.
 *
 * The only place that knows which executable and arguments each package
 * manager gets. Everything else asks this table.
 */

import { detectPackageManager } from './npm-package-manager.js';

export type Driver = 'npm' | 'pnpm';

export interface CommandLine {
  command: Driver;
  args: string[];
}

/**
 * The package manager that answers version and configuration queries in
 * `dir`. Yarn and Bun repositories are not refused for read-only queries and
 * are served by npm.
 */
export function driverFor(dir: string): Driver {
  return detectPackageManager(dir).name === 'pnpm' ? 'pnpm' : 'npm';
}

export const commands = {
  /** Install after Elevate wrote new ranges. pnpm is told explicitly not to freeze: `CI` would otherwise imply it. */
  install: (m: Driver): CommandLine =>
    m === 'pnpm' ? { command: 'pnpm', args: ['install', '--no-frozen-lockfile'] } : { command: 'npm', args: ['install'] },
  /** Restore the installed state after a rollback. */
  restore: (m: Driver): CommandLine =>
    m === 'pnpm' ? { command: 'pnpm', args: ['install', '--frozen-lockfile'] } : { command: 'npm', args: ['install'] },
  /** Default verification. */
  verify: (m: Driver): CommandLine =>
    m === 'pnpm'
      ? { command: 'pnpm', args: ['install', '--frozen-lockfile', '--lockfile-only'] }
      : { command: 'npm', args: ['ls'] },
  view: (m: Driver, name: string, field: string): CommandLine => ({ command: m, args: ['view', name, field, '--json'] }),
  config: (m: Driver): CommandLine => ({ command: m, args: ['config', 'list', '--json'] }),
};
