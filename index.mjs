#!/usr/bin/env node

/**
 * 🪶 Elevate — Universal Launcher
 *
 * Dispatches to interactive TUI or headless CLI/MCP subcommands.
 * Runs directly via node and the local tsx binary for maximal performance
 * without shell overhead or deprecation warnings.
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = join(__dirname, 'src', 'index.tsx');
const tsxCli = join(__dirname, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const child = spawn(process.execPath, [tsxCli, entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));
