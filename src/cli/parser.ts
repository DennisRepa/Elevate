/**
 * 🪶 Elevate — CLI Argument Parser
 *
 * Provides typed, zero-dependency command line argument parsing
 * using Node.js native `node:util.parseArgs` conventions.
 */

export interface CliOptions {
  subcommand?: 'modules' | 'scan' | 'versions' | 'update' | 'mcp' | 'help';
  ecosystem?: 'npm' | 'maven';
  module?: string;
  channel?: 'stable' | 'all';
  packages?: string[];
  all?: boolean;
  allModules?: boolean;
  allowMajor?: boolean;
  dryRun?: boolean;
  skipVerify?: boolean;
  json?: boolean;
  positional?: string;
  help?: boolean;
}

export function parseCliArgs(args: string[]): CliOptions {
  const [first, ...rest] = args;

  if (!first || first === '--help' || first === '-h' || first === 'help') {
    if (first === '--help' || first === '-h' || first === 'help') {
      return { subcommand: 'help' };
    }
    // No arguments provided -> launch interactive TUI
    return {};
  }

  // Direct MCP Server invocation
  if (first === 'mcp' || first === 'serve') {
    return { subcommand: 'mcp' };
  }

  const validCommands = ['modules', 'scan', 'versions', 'update'] as const;
  const isSubcommand = validCommands.includes(first as any);

  const subcommand = isSubcommand ? (first as 'modules' | 'scan' | 'versions' | 'update') : undefined;
  const remaining = isSubcommand ? rest : args;

  const result: CliOptions = { subcommand };
  const positionals: string[] = [];

  for (let i = 0; i < remaining.length; i++) {
    const arg = remaining[i]!;

    if (arg === '--json') {
      result.json = true;
    } else if (arg === '--all') {
      result.all = true;
    } else if (arg === '--all-modules') {
      result.allModules = true;
    } else if (arg === '--allow-major') {
      result.allowMajor = true;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--skip-verify') {
      result.skipVerify = true;
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg.startsWith('--ecosystem=')) {
      const val = arg.split('=')[1];
      if (val === 'npm' || val === 'maven') result.ecosystem = val;
    } else if (arg === '-e' || arg === '--ecosystem') {
      const val = remaining[++i];
      if (val === 'npm' || val === 'maven') result.ecosystem = val;
    } else if (arg.startsWith('--module=')) {
      result.module = arg.split('=')[1];
    } else if (arg === '-m' || arg === '--module') {
      result.module = remaining[++i];
    } else if (arg.startsWith('--channel=')) {
      const val = arg.split('=')[1];
      if (val === 'stable' || val === 'all') result.channel = val;
    } else if (arg === '-c' || arg === '--channel') {
      const val = remaining[++i];
      if (val === 'stable' || val === 'all') result.channel = val;
    } else if (arg.startsWith('--packages=')) {
      result.packages = arg.split('=')[1]?.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '-p' || arg === '--packages') {
      result.packages = remaining[++i]?.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (!arg.startsWith('-')) {
      positionals.push(arg);
    }
  }

  if (positionals.length > 0) {
    result.positional = positionals[0];
  }

  return result;
}

export function printCliHelp(): void {
  console.log(`
🪶 Elevate — Modern Polyglot Dependency Manager & Updater

USAGE:
  elevate                               Launch interactive terminal dashboard (TUI)
  elevate <subcommand> [flags]          Execute headless command (for CI/CD & AI agents)
  elevate mcp                           Start Model Context Protocol (MCP) server

SUBCOMMANDS:
  modules                               List all detected repository modules
  scan                                  Scan dependencies for available updates
  versions <package>                    List all published versions of a package
  update                                Apply updates to specified or all packages
  mcp                                   Start stdio-based MCP server

FLAGS:
  -e, --ecosystem <npm|maven>          Target ecosystem (default: npm)
  -m, --module <name|path>             Target module ID or relative path (default: root)
  -c, --channel <stable|all>           Release channel (default: stable)
  -p, --packages <pkg1,pkg2@1.2.3>     Comma-separated list of packages to update
      --all                            Update all eligible dependencies
      --all-modules                    Scan across all discovered monorepo modules
      --allow-major                    Allow breaking major version upgrades
      --dry-run                        Simulate updates without modifying any files
      --skip-verify                    Skip post-update build & test verification
      --json                           Format output as machine-readable JSON
  -h, --help                           Display this help message

EXAMPLES:
  elevate scan --json
  elevate scan --ecosystem=maven --channel=stable --all-modules --json
  elevate versions chalk --ecosystem=npm --json
  elevate update --module=apps/e2e-cockpit --packages=chalk@5.6.2 --json
  elevate update --ecosystem=npm --all --allow-major --dry-run
`);
}
