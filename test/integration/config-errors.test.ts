/**
 * CONF-07: the command line stops before doing anything when
 * elevate.config.json is broken. Runs the real entry point in a child process.
 *
 *   npm run test:integration
 */

import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupTemp, makeTree } from '../helpers.js';

afterAll(cleanupTemp);

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TSX = join(PROJECT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const ENTRY = join(PROJECT, 'src', 'index.tsx');

describe('a repository with an invalid elevate.config.json', () => {
  it.each([['modules', '--json'], ['scan', '--json'], ['mcp']])(
    'CONF-07 Every command stops before doing anything: %s',
    (...args) => {
      const manifest = '{"name": "root", "version": "1.0.0", "dependencies": {"left-pad": "^1.1.0"}}';
      const root = makeTree({
        '.git/HEAD': 'ref: refs/heads/main',
        'package.json': manifest,
        'elevate.config.json': '{ "internalScopes": "@acme" }',
      });

      const result = spawnSync(process.execPath, [TSX, '--tsconfig', join(PROJECT, 'tsconfig.json'), ENTRY, ...args], {
        cwd: root,
        encoding: 'utf8',
        input: '',
        timeout: 60_000,
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('`internalScopes` must be a list of strings');
      expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(manifest);
    },
  );
});
