/**
 * Starts the real command line and the real MCP server (through tsx) for the
 * integration tests.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = [join(PROJECT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), '--tsconfig', join(PROJECT, 'tsconfig.json'), join(PROJECT, 'src', 'index.tsx')];

/** Runs `elevate <args>` in a directory. */
export function elevate(cwd: string, ...args: string[]) {
  return spawnSync(process.execPath, [...ARGS, ...args], { cwd, encoding: 'utf8', input: '', timeout: 300_000 });
}

/** Runs `use` with an MCP client connected to a real `elevate mcp` started in a directory. */
export async function withMcp<T>(cwd: string, use: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [...ARGS, 'mcp'], cwd, stderr: 'ignore' });
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(transport);
  try {
    return await use(client);
  } finally {
    await client.close();
  }
}

/** The JSON a tool call answered with. */
export const jsonOf = (result: unknown): any => JSON.parse((result as { content: { text: string }[] }).content[0]!.text);
