/**
 * 🪶 Elevate — Model Context Protocol (MCP) Server
 *
 * Exposes five granular MCP tools over stdio for AI agents
 * (Claude, Antigravity, Cursor, GitHub Copilot). The tools share their
 * logic with the CLI through the application layer.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ElevateConfig } from '../config.js';
import type { ProjectModule, ReleaseChannel } from '../domain/models.js';
import { EcosystemFactory } from '../domain/ecosystem-factory.js';
import { classifyOrigin } from '../domain/origin.js';
import { isPreReleaseVersion, extractPreReleaseTag } from '../domain/versions.js';
import { candidateToJson, createScanContext, findModule, scanModule, scanModules } from '../application/scan.js';
import { describeSkip } from '../application/describe.js';
import { selectRequested } from '../application/update-selection.js';
import type { UpdateRequest } from '../application/update-selection.js';
import { runUpdateWorkflow } from '../application/update-workflow.js';
import { coordinateFromIdentifier, lookupVersions } from '../application/version-lookup.js';

const ECOSYSTEM_PROPERTY = {
  type: 'string',
  enum: ['npm', 'maven'],
  description: 'Target ecosystem (default: npm)',
};

export async function startMcpServer(config: ElevateConfig): Promise<void> {
  const server = new Server(
    {
      name: 'elevate-mcp',
      version: '1.2.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // 1. Tool definitions and schemas
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'elevate_discover_modules',
          description:
            'Discovers all repository modules and workspaces for Node/npm (package.json) or Java/Maven (pom.xml).',
          inputSchema: {
            type: 'object',
            properties: {
              ecosystem: ECOSYSTEM_PROPERTY,
            },
          },
        },
        {
          name: 'elevate_scan',
          description:
            'Scans a module (or all modules) for available dependency updates. Each update has an origin ' +
            '(workspace, private, public) and an action: "update" (newer registry version) or "align" ' +
            '(set an internal dependency to the local version of the workspace module). Dependencies that ' +
            'could not be offered are listed under "skipped" with the reason.',
          inputSchema: {
            type: 'object',
            properties: {
              ecosystem: ECOSYSTEM_PROPERTY,
              moduleId: {
                type: 'string',
                description:
                  'Module ID or relative path (e.g. "apps/e2e-cockpit"). If omitted, scans the root or primary module.',
              },
              channel: {
                type: 'string',
                enum: ['stable', 'all'],
                description:
                  'Release channel: "stable" (production-ready versions only) or "all" (including pre-releases/betas). Default: stable',
              },
              allModules: {
                type: 'boolean',
                description: 'If true, scans all discovered modules across the monorepo.',
              },
            },
          },
        },
        {
          name: 'elevate_get_versions',
          description:
            'Fetches the complete published version history of a package from the registry. ' +
            'Refuses to query a public registry for internal packages (internalScopes).',
          inputSchema: {
            type: 'object',
            properties: {
              ecosystem: ECOSYSTEM_PROPERTY,
              identifier: {
                type: 'string',
                description: 'Package identifier (npm: chalk, maven: org.slf4j:slf4j-api)',
              },
            },
            required: ['identifier'],
          },
        },
        {
          name: 'elevate_apply_updates',
          description:
            'Applies targeted dependency updates to a module, installs packages and runs build & test verification. ' +
            'If installation, the workspace link check or verification fails, all changes are rolled back.',
          inputSchema: {
            type: 'object',
            properties: {
              ecosystem: ECOSYSTEM_PROPERTY,
              moduleId: {
                type: 'string',
                description: 'Module ID or relative path of the target module',
              },
              updates: {
                type: 'array',
                description: 'List of packages to update with optional target versions',
                items: {
                  type: 'object',
                  properties: {
                    identifier: { type: 'string', description: 'Package identifier' },
                    targetVersion: {
                      type: 'string',
                      description:
                        'Specific target version (e.g. "5.6.2"). If omitted, the version offered by the scan is used.',
                    },
                  },
                  required: ['identifier'],
                },
              },
              allowMajor: {
                type: 'boolean',
                description: 'Safety guardrail: Must be explicitly true to permit breaking major version upgrades.',
              },
              dryRun: {
                type: 'boolean',
                description: 'If true, simulates planned changes without modifying any files.',
              },
              skipVerification: {
                type: 'boolean',
                description: 'Skips the post-update build and test verification step.',
              },
              keepOnFailure: {
                type: 'boolean',
                description: 'Keeps the changes when verification fails instead of rolling them back.',
              },
            },
            required: ['moduleId', 'updates'],
          },
        },
        {
          name: 'elevate_verify',
          description:
            'Runs module-specific verification and build checks (e.g. npm ls, mvn test-compile).',
          inputSchema: {
            type: 'object',
            properties: {
              ecosystem: ECOSYSTEM_PROPERTY,
              moduleId: {
                type: 'string',
                description: 'Module ID or relative path of the module to verify',
              },
            },
          },
        },
      ],
    };
  });

  // 2. Tool execution handlers
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const ecosystem = (args.ecosystem as 'npm' | 'maven') || 'npm';
    const strategy = EcosystemFactory.getStrategy(ecosystem);
    const reply = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });

    const resolveModule = (modules: ProjectModule[], query: unknown): ProjectModule => {
      const mod = query ? findModule(modules, String(query)) : modules[0];
      if (!mod) throw new Error(`Module '${query ?? 'default'}' not found.`);
      return mod;
    };

    try {
      // ── Tool 1: elevate_discover_modules ──
      if (name === 'elevate_discover_modules') {
        const modules = await strategy.discovery.discover(config.rootDir);
        return reply({
          ecosystem,
          count: modules.length,
          modules: modules.map((m) => ({
            id: m.id,
            name: m.name,
            relPath: m.relPath,
            isRoot: m.isRoot,
            version: m.version,
          })),
        });
      }

      // ── Tool 2: elevate_scan ──
      if (name === 'elevate_scan') {
        const channel = (args.channel as ReleaseChannel) || config.channel || 'stable';
        const modules = await strategy.discovery.discover(config.rootDir);
        const targetModules = args.allModules ? modules : [resolveModule(modules, args.moduleId)];
        const context = createScanContext(modules, config, channel);

        const results: unknown[] = [];
        let totalCount = 0;
        const scanned = await scanModules(strategy, targetModules, context);
        for (const mod of targetModules) {
          const result = scanned.get(mod)!;
          totalCount += result.candidates.length;
          results.push({
            moduleId: mod.id,
            modulePath: mod.relPath,
            updateCount: result.candidates.length,
            error: result.error,
            updates: result.candidates.map(candidateToJson),
            skipped: result.skipped.map((s) => ({ ...s, explanation: describeSkip(s) })),
          });
        }

        return reply({ ecosystem, channel, scannedModules: targetModules.length, totalUpdatesCount: totalCount, results });
      }

      // ── Tool 3: elevate_get_versions ──
      if (name === 'elevate_get_versions') {
        const identifier = String(args.identifier);
        const versions = await lookupVersions(strategy, coordinateFromIdentifier(identifier, ecosystem), config);
        return reply({
          ecosystem,
          package: identifier,
          totalCount: versions.length,
          latest: versions[0] || null,
          versions: versions.map((v) => ({
            version: v,
            isPreRelease: isPreReleaseVersion(v),
            tag: extractPreReleaseTag(v),
          })),
        });
      }

      // ── Tool 4: elevate_apply_updates ──
      if (name === 'elevate_apply_updates') {
        const modules = await strategy.discovery.discover(config.rootDir);
        const mod = resolveModule(modules, args.moduleId);
        const context = createScanContext(modules, config, config.channel);
        const scan = await scanModule(strategy, mod, context);
        if (scan.error) throw new Error(`Scan failed: ${scan.error}`);

        const updatesToApply = selectRequested(scan, (args.updates as UpdateRequest[]) || [], {
          ecosystem,
          allowMajor: Boolean(args.allowMajor),
          originOf: (identifier) => classifyOrigin(identifier, ecosystem, context).kind,
        });

        if (updatesToApply.length === 0) {
          return reply({ success: true, targetModule: mod.relPath, ecosystem, updatedCount: 0, message: 'No updates selected to apply.' });
        }

        if (args.dryRun) {
          return reply({
            dryRun: true,
            targetModule: mod.relPath,
            ecosystem,
            updatesCount: updatesToApply.length,
            updates: updatesToApply.map((u) => ({
              identifier: u.coordinate.identifier,
              action: u.action,
              currentRange: u.currentRange,
              newRange: u.newRange,
              diff: u.diff,
              declaredIn: u.declaration?.displayPath,
            })),
          });
        }

        const summary = await runUpdateWorkflow(strategy, mod, config.rootDir, updatesToApply, {
          postUpdateScript: config.postUpdateScript,
          postUpdateLabel: config.postUpdateLabel,
          skipVerification: Boolean(args.skipVerification),
          keepOnFailure: Boolean(args.keepOnFailure),
        });

        return reply({
          success: !summary.rolledBack && summary.verificationStatus !== 'warn',
          targetModule: mod.relPath,
          ecosystem,
          ...summary,
        });
      }

      // ── Tool 5: elevate_verify ──
      if (name === 'elevate_verify') {
        const modules = await strategy.discovery.discover(config.rootDir);
        const mod = resolveModule(modules, args.moduleId);
        const verifyResult = await strategy.verifier.verify(mod, config.rootDir, {
          customScript: config.postUpdateScript,
          customLabel: config.postUpdateLabel,
        });
        return reply({ module: mod.relPath, ecosystem, ...verifyResult });
      }

      throw new Error(`Unknown tool: ${name}`);
    } catch (err: any) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `❌ Error executing tool '${name}': ${err.message || String(err)}`,
          },
        ],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
