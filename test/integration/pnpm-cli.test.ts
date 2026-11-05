/**
 * PWS-14, PWS-15 and PWS-16: the module listing names the package manager,
 * checked through the real command line and the real MCP server.
 *
 *   npm run test:integration
 */

import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { cleanupTemp, makeTree } from '../helpers.js';

afterAll(cleanupTemp);

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ARGS = [join(PROJECT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), '--tsconfig', join(PROJECT, 'tsconfig.json'), join(PROJECT, 'src', 'index.tsx')];

const PNPM_TREE = {
  '.git/HEAD': 'ref: refs/heads/main',
  'package.json': '{"name": "mono", "private": true}',
  'pnpm-workspace.yaml': 'packages: ["packages/*"]',
  'pnpm-lock.yaml': "lockfileVersion: '9.0'",
  'packages/a/package.json': '{"name": "a", "version": "1.0.0"}',
};

function elevate(cwd: string, ...args: string[]) {
  return spawnSync(process.execPath, [...ARGS, ...args], { cwd, encoding: 'utf8', input: '', timeout: 60_000 });
}

describe('the module listing names the package manager', () => {
  it('PWS-14 The module listing says that the repository is managed by pnpm', () => {
    const root = makeTree(PNPM_TREE);
    const json = elevate(root, 'modules', '--json');
    expect(json.status).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({ ecosystem: 'npm', packageManager: 'pnpm' });
    const text = elevate(root, 'modules');
    expect(text.stdout.split('\n').find((l) => l.includes('Discovered'))).toBe(
      '🪶 Discovered 📦 Node / pnpm Modules (2):',
    );
  });

  it('PWS-15 A repository without pnpm evidence reports npm', () => {
    const root = makeTree({
      '.git/HEAD': 'ref: refs/heads/main',
      'package.json': '{"name": "mono", "version": "1.0.0"}',
      'package-lock.json': '{}',
    });
    expect(JSON.parse(elevate(root, 'modules', '--json').stdout)).toMatchObject({ ecosystem: 'npm', packageManager: 'npm' });
  });

  it('PWS-16 The MCP tool elevate_discover_modules reports the package manager of an npm ecosystem', async () => {
    const root = makeTree({ ...PNPM_TREE, 'backend/pom.xml': '<project><modelVersion>4.0.0</modelVersion><groupId>g</groupId><artifactId>b</artifactId><version>1</version></project>' });
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [...ARGS, 'mcp'], cwd: root, stderr: 'ignore' }));
    try {
      const call = async (ecosystem: string) => {
        const res: any = await client.callTool({ name: 'elevate_discover_modules', arguments: { ecosystem } });
        return JSON.parse(res.content[0].text);
      };
      expect(await call('npm')).toMatchObject({ packageManager: 'pnpm' });
      expect(await call('maven')).not.toHaveProperty('packageManager');
    } finally {
      await client.close();
    }
  });
});
