#!/usr/bin/env node

/**
 * 🪶 Elevate — Universal Entry Point
 *
 * Dispatches to:
 * - Interactive TUI Dashboard (default when run without arguments)
 * - Headless CLI Subcommands (modules, scan, versions, update) with JSON output
 * - Model Context Protocol (MCP) Server for AI Agents
 */

import React from 'react';
import { render } from 'ink';
import { ConfigError, loadConfig } from './config.js';
import { EcosystemFactory } from './domain/ecosystem-factory.js';
import { App } from './app.js';
import { parseCliArgs, printCliHelp } from './cli/parser.js';
import { handleModulesCommand } from './cli/command-modules.js';
import { handleScanCommand } from './cli/command-scan.js';
import { handleVersionsCommand } from './cli/command-versions.js';
import { handleUpdateCommand } from './cli/command-update.js';
import { handleInitCommand } from './cli/command-init.js';
import { startMcpServer } from './mcp/mcp-server.js';

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    // Nothing has been done yet; stderr keeps stdout free for machine-readable output.
    process.stderr.write(`❌ ${err.message}\n`);
    process.exit(1);
  }
  EcosystemFactory.configure({ mavenPlugins: config.mavenPlugins });
  const options = parseCliArgs(process.argv.slice(2));

  // stderr keeps JSON output on stdout machine-readable.
  for (const notice of [...config.deprecations, ...config.warnings]) process.stderr.write(`⚠️  ${notice}\n`);

  // 1. Help
  if (options.subcommand === 'help' || options.help) {
    printCliHelp();
    process.exit(0);
  }

  // 2. Model Context Protocol (MCP) Server
  if (options.subcommand === 'mcp') {
    await startMcpServer(config);
    return;
  }

  // 3. Headless CLI Subcommands (for CI/CD & AI Agents)
  if (options.subcommand === 'modules') {
    const exitCode = await handleModulesCommand(options, config);
    process.exit(exitCode);
  }

  if (options.subcommand === 'scan') {
    const exitCode = await handleScanCommand(options, config);
    process.exit(exitCode);
  }

  if (options.subcommand === 'versions') {
    const exitCode = await handleVersionsCommand(options, config);
    process.exit(exitCode);
  }

  if (options.subcommand === 'update') {
    const exitCode = await handleUpdateCommand(options, config);
    process.exit(exitCode);
  }

  if (options.subcommand === 'init') {
    const exitCode = await handleInitCommand(options);
    process.exit(exitCode);
  }

  // 4. Interactive Terminal Dashboard (TUI) Mode
  if (process.stdout.isTTY) {
    const minCols = 140;
    const minRows = 38;
    const cols = Math.max(process.stdout.columns || 80, minCols);
    const rows = Math.max(process.stdout.rows || 24, minRows);
    process.stdout.write(`\x1b[8;${rows};${cols}t`);
  }

  render(<App config={config} />);
}

main().catch((err) => {
  console.error('❌ Elevate fatal error:', err);
  process.exit(1);
});
