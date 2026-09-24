/**
 * 🪶 Elevate — CLI Command: `init`
 *
 * Auto-detects AI coding environments (Cursor, Claude, Antigravity, VS Code,
 * Windsurf) and configures Elevate's MCP server + agent skill files so that
 * AI agents automatically discover and prefer Elevate for dependency management.
 *
 * Usage:
 *   elevate init              Interactive auto-detection
 *   elevate init --all        Configure all detected environments without prompts
 *   elevate init --json       Machine-readable output
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import type { CliOptions } from './parser.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface DetectedEnvironment {
  id: string;
  name: string;
  icon: string;
  detected: boolean;
  reason: string;
  mcpConfigured: boolean;
  skillConfigured: boolean;
}

interface InitResult {
  cwd: string;
  environments: DetectedEnvironment[];
  actions: string[];
  errors: string[];
}

// ── MCP Server Entry (identical across all environments) ─────────────────────

function mcpServerEntry(): Record<string, unknown> {
  return {
    command: 'npx',
    args: ['-y', '@dennisrepa/elevate', 'mcp'],
  };
}

// ── Skill / Instruction Content ──────────────────────────────────────────────

const ELEVATE_SKILL_CONTENT = `# Elevate — Dependency Management Agent Skill

## When to Use
Use the Elevate MCP tools whenever the task involves:
- Scanning or auditing dependencies for available updates
- Updating one or more packages to specific or latest versions
- Listing available versions of a package from npm or Maven registries
- Discovering monorepo modules and their dependency structure
- Any dependency-related operation in a monorepo

## Important
**Never** run raw \`npm update\`, \`npm install <pkg>@latest\`, or manually edit
\`package.json\` / \`pom.xml\` version fields. Always use Elevate's MCP tools
instead — they handle monorepo-aware scanning, safety guardrails (major version
protection), and post-update verification automatically.

## Available MCP Tools
| Tool                    | Purpose                                                      |
|-------------------------|--------------------------------------------------------------|
| \`elevate_scan\`          | Scan dependencies for available updates with diff analysis   |
| \`elevate_update\`        | Apply updates with safety guardrails and verification        |
| \`elevate_get_versions\`  | List all published versions of a specific package            |
| \`elevate_list_modules\`  | Discover all modules in a monorepo                           |
| \`elevate_health_check\`  | Run build & audit verification after updates                 |

## Typical Workflow
1. \`elevate_list_modules\` — Discover project structure
2. \`elevate_scan\` — Identify outdated dependencies
3. \`elevate_update\` — Apply selected updates (use \`--allow-major\` only when explicitly requested)
4. \`elevate_health_check\` — Verify build integrity
`;

// ── Path Helpers ─────────────────────────────────────────────────────────────

const home = homedir();
const isWin = platform() === 'win32';

function appData(): string {
  return process.env.APPDATA || join(home, 'AppData', 'Roaming');
}

// ── Environment Detectors ────────────────────────────────────────────────────

function detectCursor(cwd: string): DetectedEnvironment {
  const env: DetectedEnvironment = {
    id: 'cursor',
    name: 'Cursor',
    icon: '🖱️',
    detected: false,
    reason: '',
    mcpConfigured: false,
    skillConfigured: false,
  };

  // Check workspace-level .cursor/ dir
  const workspaceCursorDir = join(cwd, '.cursor');
  const globalCursorDir = join(home, '.cursor');

  if (existsSync(workspaceCursorDir) || existsSync(globalCursorDir)) {
    env.detected = true;
    env.reason = existsSync(workspaceCursorDir)
      ? `Found .cursor/ in workspace`
      : `Found ~/.cursor/ global config`;
  }

  // Check if MCP already configured
  const mcpPath = join(cwd, '.cursor', 'mcp.json');
  if (existsSync(mcpPath)) {
    try {
      const content = JSON.parse(readFileSync(mcpPath, 'utf8'));
      if (content?.mcpServers?.elevate) {
        env.mcpConfigured = true;
      }
    } catch { /* ignore */ }
  }

  // Check if rules already exist
  const rulesPath = join(cwd, '.cursorrules');
  if (existsSync(rulesPath)) {
    const content = readFileSync(rulesPath, 'utf8');
    if (content.includes('elevate') || content.includes('Elevate')) {
      env.skillConfigured = true;
    }
  }

  return env;
}

function detectClaudeDesktop(): DetectedEnvironment {
  const env: DetectedEnvironment = {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    icon: '🤖',
    detected: false,
    reason: '',
    mcpConfigured: false,
    skillConfigured: false,
  };

  const configPath = isWin
    ? join(appData(), 'Claude', 'claude_desktop_config.json')
    : join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');

  if (existsSync(configPath)) {
    env.detected = true;
    env.reason = `Found ${configPath}`;

    try {
      const content = JSON.parse(readFileSync(configPath, 'utf8'));
      if (content?.mcpServers?.elevate) {
        env.mcpConfigured = true;
      }
    } catch { /* ignore */ }
  }

  return env;
}

function detectClaudeCode(cwd: string): DetectedEnvironment {
  const env: DetectedEnvironment = {
    id: 'claude-code',
    name: 'Claude Code',
    icon: '⌨️',
    detected: false,
    reason: '',
    mcpConfigured: false,
    skillConfigured: false,
  };

  // Check for .mcp.json (project scope) or CLAUDE.md
  const mcpJsonPath = join(cwd, '.mcp.json');
  const claudeMdPath = join(cwd, 'CLAUDE.md');

  if (existsSync(mcpJsonPath) || existsSync(claudeMdPath)) {
    env.detected = true;
    env.reason = existsSync(mcpJsonPath)
      ? `Found .mcp.json in workspace`
      : `Found CLAUDE.md in workspace`;
  }

  // Check if MCP already configured
  if (existsSync(mcpJsonPath)) {
    try {
      const content = JSON.parse(readFileSync(mcpJsonPath, 'utf8'));
      if (content?.mcpServers?.elevate) {
        env.mcpConfigured = true;
      }
    } catch { /* ignore */ }
  }

  // Check if skill already in CLAUDE.md
  if (existsSync(claudeMdPath)) {
    const content = readFileSync(claudeMdPath, 'utf8');
    if (content.includes('elevate') || content.includes('Elevate')) {
      env.skillConfigured = true;
    }
  }

  return env;
}

function detectAntigravity(cwd: string): DetectedEnvironment {
  const env: DetectedEnvironment = {
    id: 'antigravity',
    name: 'Google Antigravity',
    icon: '🚀',
    detected: false,
    reason: '',
    mcpConfigured: false,
    skillConfigured: false,
  };

  // Check global ~/.gemini/ or workspace .agents/
  const globalGeminiDir = join(home, '.gemini');
  const workspaceAgentsDir = join(cwd, '.agents');

  if (existsSync(globalGeminiDir) || existsSync(workspaceAgentsDir)) {
    env.detected = true;
    env.reason = existsSync(workspaceAgentsDir)
      ? `Found .agents/ in workspace`
      : `Found ~/.gemini/ global config`;
  }

  // Check if MCP already configured
  const mcpPaths = [
    join(cwd, '.agents', 'mcp_config.json'),
    join(home, '.gemini', 'config', 'mcp_config.json'),
  ];
  for (const p of mcpPaths) {
    if (existsSync(p)) {
      try {
        const content = JSON.parse(readFileSync(p, 'utf8'));
        if (content?.mcpServers?.elevate) {
          env.mcpConfigured = true;
          break;
        }
      } catch { /* ignore */ }
    }
  }

  return env;
}

function detectVSCode(cwd: string): DetectedEnvironment {
  const env: DetectedEnvironment = {
    id: 'vscode',
    name: 'VS Code / Copilot',
    icon: '💎',
    detected: false,
    reason: '',
    mcpConfigured: false,
    skillConfigured: false,
  };

  const vscodeDir = join(cwd, '.vscode');
  if (existsSync(vscodeDir)) {
    env.detected = true;
    env.reason = `Found .vscode/ in workspace`;
  }

  // Check if MCP already configured
  const mcpPath = join(cwd, '.vscode', 'mcp.json');
  if (existsSync(mcpPath)) {
    try {
      const content = JSON.parse(readFileSync(mcpPath, 'utf8'));
      if (content?.servers?.elevate) {
        env.mcpConfigured = true;
      }
    } catch { /* ignore */ }
  }

  // Check copilot instructions
  const copilotInstructions = join(cwd, '.github', 'copilot-instructions.md');
  if (existsSync(copilotInstructions)) {
    const content = readFileSync(copilotInstructions, 'utf8');
    if (content.includes('elevate') || content.includes('Elevate')) {
      env.skillConfigured = true;
    }
  }

  return env;
}

function detectWindsurf(): DetectedEnvironment {
  const env: DetectedEnvironment = {
    id: 'windsurf',
    name: 'Windsurf',
    icon: '🏄',
    detected: false,
    reason: '',
    mcpConfigured: false,
    skillConfigured: false,
  };

  const configPath = isWin
    ? join(appData(), 'Codeium', 'Windsurf', 'mcp_config.json')
    : join(home, '.codeium', 'windsurf', 'mcp_config.json');

  // Also check the alternate location
  const altPath = join(home, '.codeium', 'windsurf', 'mcp_config.json');

  if (existsSync(configPath) || existsSync(altPath)) {
    env.detected = true;
    env.reason = `Found Windsurf config`;

    const path = existsSync(configPath) ? configPath : altPath;
    try {
      const content = JSON.parse(readFileSync(path, 'utf8'));
      if (content?.mcpServers?.elevate) {
        env.mcpConfigured = true;
      }
    } catch { /* ignore */ }
  }

  return env;
}

// ── Configuration Writers ────────────────────────────────────────────────────

function mergeJsonMcpServer(
  filePath: string,
  serverKey: string,
  topLevelKey: string,
): { written: boolean; message: string } {
  let existing: Record<string, unknown> = {};

  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
      existing = {};
    }
  }

  const servers = (existing[topLevelKey] as Record<string, unknown>) || {};
  if (servers[serverKey]) {
    return { written: false, message: `${filePath}: elevate already registered` };
  }

  servers[serverKey] = mcpServerEntry();
  existing[topLevelKey] = servers;

  const dir = filePath.substring(0, filePath.lastIndexOf(isWin ? '\\' : '/'));
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(filePath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
  return { written: true, message: `${filePath}: elevate MCP server registered` };
}

function appendSkillToFile(
  filePath: string,
  content: string,
  marker: string,
): { written: boolean; message: string } {
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, 'utf8');
    if (existing.includes(marker)) {
      return { written: false, message: `${filePath}: skill already present` };
    }
    writeFileSync(filePath, existing + '\n\n' + content, 'utf8');
    return { written: true, message: `${filePath}: skill appended` };
  }

  const dir = filePath.substring(0, filePath.lastIndexOf(isWin ? '\\' : '/'));
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(filePath, content, 'utf8');
  return { written: true, message: `${filePath}: skill created` };
}

// ── Per-Environment Configurators ────────────────────────────────────────────

function configureCursor(cwd: string, result: InitResult): void {
  // MCP
  const mcpPath = join(cwd, '.cursor', 'mcp.json');
  const mcp = mergeJsonMcpServer(mcpPath, 'elevate', 'mcpServers');
  result.actions.push(`${mcp.written ? '✅' : '⏭️'}  Cursor MCP: ${mcp.message}`);

  // Skills (.cursorrules)
  const rulesPath = join(cwd, '.cursorrules');
  const skill = appendSkillToFile(rulesPath, ELEVATE_SKILL_CONTENT, 'elevate_scan');
  result.actions.push(`${skill.written ? '✅' : '⏭️'}  Cursor Rules: ${skill.message}`);
}

function configureClaudeDesktop(result: InitResult): void {
  const configPath = isWin
    ? join(appData(), 'Claude', 'claude_desktop_config.json')
    : join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');

  const mcp = mergeJsonMcpServer(configPath, 'elevate', 'mcpServers');
  result.actions.push(`${mcp.written ? '✅' : '⏭️'}  Claude Desktop MCP: ${mcp.message}`);
}

function configureClaudeCode(cwd: string, result: InitResult): void {
  // MCP (.mcp.json in project root)
  const mcpPath = join(cwd, '.mcp.json');
  const mcp = mergeJsonMcpServer(mcpPath, 'elevate', 'mcpServers');
  result.actions.push(`${mcp.written ? '✅' : '⏭️'}  Claude Code MCP: ${mcp.message}`);

  // Skills (CLAUDE.md)
  const claudeMdPath = join(cwd, 'CLAUDE.md');
  const skill = appendSkillToFile(claudeMdPath, ELEVATE_SKILL_CONTENT, 'elevate_scan');
  result.actions.push(`${skill.written ? '✅' : '⏭️'}  Claude Code Skill: ${skill.message}`);
}

function configureAntigravity(cwd: string, result: InitResult): void {
  // MCP (workspace-level .agents/mcp_config.json)
  const mcpPath = join(cwd, '.agents', 'mcp_config.json');
  const mcp = mergeJsonMcpServer(mcpPath, 'elevate', 'mcpServers');
  result.actions.push(`${mcp.written ? '✅' : '⏭️'}  Antigravity MCP: ${mcp.message}`);
}

function configureVSCode(cwd: string, result: InitResult): void {
  // MCP (.vscode/mcp.json — note: VS Code uses "servers" not "mcpServers")
  const mcpPath = join(cwd, '.vscode', 'mcp.json');
  const mcp = mergeJsonMcpServer(mcpPath, 'elevate', 'servers');
  result.actions.push(`${mcp.written ? '✅' : '⏭️'}  VS Code MCP: ${mcp.message}`);

  // Copilot instructions
  const instructionsPath = join(cwd, '.github', 'copilot-instructions.md');
  const skill = appendSkillToFile(instructionsPath, ELEVATE_SKILL_CONTENT, 'elevate_scan');
  result.actions.push(`${skill.written ? '✅' : '⏭️'}  Copilot Instructions: ${skill.message}`);
}

function configureWindsurf(result: InitResult): void {
  const configPath = isWin
    ? join(appData(), 'Codeium', 'Windsurf', 'mcp_config.json')
    : join(home, '.codeium', 'windsurf', 'mcp_config.json');

  const mcp = mergeJsonMcpServer(configPath, 'elevate', 'mcpServers');
  result.actions.push(`${mcp.written ? '✅' : '⏭️'}  Windsurf MCP: ${mcp.message}`);
}

// ── Main Command Handler ─────────────────────────────────────────────────────

export async function handleInitCommand(options: CliOptions): Promise<number> {
  const cwd = resolve(process.cwd());

  const result: InitResult = {
    cwd,
    environments: [],
    actions: [],
    errors: [],
  };

  // ── Step 1: Detect all environments ────────────────────────────────────────

  const detectors: (() => DetectedEnvironment)[] = [
    () => detectCursor(cwd),
    () => detectClaudeDesktop(),
    () => detectClaudeCode(cwd),
    () => detectAntigravity(cwd),
    () => detectVSCode(cwd),
    () => detectWindsurf(),
  ];

  for (const detect of detectors) {
    result.environments.push(detect());
  }

  const detected = result.environments.filter((e) => e.detected);

  // ── Step 2: Configure detected environments ────────────────────────────────

  if (detected.length === 0) {
    // Nothing detected? Still offer to create foundational files
    if (!options.json) {
      console.log(`\n🪶 Elevate Init\n`);
      console.log(`  No AI coding environments detected in this workspace.`);
      console.log(`  Creating portable .mcp.json for broad compatibility.\n`);
    }
    // Create a generic .mcp.json that works with Claude Code and most MCP clients
    const mcpPath = join(cwd, '.mcp.json');
    const mcp = mergeJsonMcpServer(mcpPath, 'elevate', 'mcpServers');
    result.actions.push(`${mcp.written ? '✅' : '⏭️'}  Generic MCP: ${mcp.message}`);
  } else {
    if (!options.json) {
      console.log(`\n🪶 Elevate Init — Detected ${detected.length} environment(s)\n`);
    }

    const configurators: Record<string, (cwd: string, result: InitResult) => void> = {
      cursor: configureCursor,
      'claude-desktop': (_cwd, r) => configureClaudeDesktop(r),
      'claude-code': configureClaudeCode,
      antigravity: configureAntigravity,
      vscode: configureVSCode,
      windsurf: (_cwd, r) => configureWindsurf(r),
    };

    for (const env of detected) {
      try {
        const configure = configurators[env.id];
        if (configure) {
          configure(cwd, result);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`${env.name}: ${msg}`);
      }
    }
  }

  // ── Step 3: Output ─────────────────────────────────────────────────────────

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.errors.length > 0 ? 1 : 0;
  }

  // Pretty console output
  console.log('  Environments:');
  for (const env of result.environments) {
    const status = env.detected ? '✅' : '  ';
    const mcpBadge = env.mcpConfigured ? ' [MCP ✓]' : '';
    const skillBadge = env.skillConfigured ? ' [Skill ✓]' : '';
    console.log(`    ${status} ${env.icon}  ${env.name.padEnd(22)}${env.detected ? env.reason : 'not detected'}${mcpBadge}${skillBadge}`);
  }

  if (result.actions.length > 0) {
    console.log(`\n  Actions:`);
    for (const action of result.actions) {
      console.log(`    ${action}`);
    }
  }

  if (result.errors.length > 0) {
    console.log(`\n  ⚠️  Errors:`);
    for (const error of result.errors) {
      console.log(`    ❌ ${error}`);
    }
  }

  console.log(`\n  Done! Restart your AI coding tools to pick up the new MCP configuration.`);
  console.log(`  Agents will now automatically use Elevate for dependency management.\n`);

  return result.errors.length > 0 ? 1 : 0;
}
