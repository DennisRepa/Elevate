/**
 * 🪶 Elevate — Model Context Protocol (MCP) Server
 *
 * Exposes 5 modular, granular MCP tools over stdio for AI Agents
 * (Claude, Antigravity, Cursor, GitHub Copilot).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import semver from 'semver';
import type { ElevateConfig } from '../config.js';
import type { UpdateCandidate, VersionDiff } from '../domain/models.js';
import { EcosystemFactory } from '../domain/ecosystem-factory.js';
import { isPreReleaseVersion, extractPreReleaseTag } from '../adapters/maven/maven-registry.js';

export async function startMcpServer(config: ElevateConfig): Promise<void> {
  const server = new Server(
    {
      name: 'elevate-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // 1. Tool definitions & schemas
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
              ecosystem: {
                type: 'string',
                enum: ['npm', 'maven'],
                description: 'Target ecosystem (default: npm)',
              },
            },
          },
        },
        {
          name: 'elevate_scan',
          description:
            'Scans a module (or all modules) for available dependency updates against the registry.',
          inputSchema: {
            type: 'object',
            properties: {
              ecosystem: {
                type: 'string',
                enum: ['npm', 'maven'],
                description: 'Target ecosystem (default: npm)',
              },
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
            'Fetches the complete published version history of a package from the registry.',
          inputSchema: {
            type: 'object',
            properties: {
              ecosystem: {
                type: 'string',
                enum: ['npm', 'maven'],
                description: 'Target ecosystem (default: npm)',
              },
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
            'Applies targeted dependency updates to a module, installs packages, and executes automatic build & test verification.',
          inputSchema: {
            type: 'object',
            properties: {
              ecosystem: {
                type: 'string',
                enum: ['npm', 'maven'],
                description: 'Target ecosystem (default: npm)',
              },
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
                      description: 'Specific target version (e.g. "5.6.2" or "^3.2.0"). If omitted, updates to latest.',
                    },
                  },
                  required: ['identifier'],
                },
              },
              allowMajor: {
                type: 'boolean',
                description:
                  'Safety guardrail: Must be explicitly true to permit breaking major version upgrades.',
              },
              dryRun: {
                type: 'boolean',
                description: 'If true, simulates planned changes without modifying any files.',
              },
              skipVerification: {
                type: 'boolean',
                description: 'Skips the post-update build and test verification step.',
              },
            },
            required: ['moduleId', 'updates'],
          },
        },
        {
          name: 'elevate_verify',
          description:
            'Runs module-specific verification and build checks (e.g. npm test, mvn test-compile).',
          inputSchema: {
            type: 'object',
            properties: {
              ecosystem: {
                type: 'string',
                enum: ['npm', 'maven'],
                description: 'Target ecosystem (default: npm)',
              },
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

    try {
      // ── Tool 1: elevate_discover_modules ──
      if (name === 'elevate_discover_modules') {
        const modules = await strategy.discovery.discover(config.rootDir);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ecosystem,
                  count: modules.length,
                  modules: modules.map((m) => ({
                    id: m.id,
                    name: m.name,
                    relPath: m.relPath,
                    isRoot: m.isRoot,
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── Tool 2: elevate_scan ──
      if (name === 'elevate_scan') {
        const channel = (args.channel as 'stable' | 'all') || config.channel || 'stable';
        const modules = await strategy.discovery.discover(config.rootDir);

        const internalIds = new Set<string>();
        for (const m of modules) {
          if (m.id) internalIds.add(m.id);
          if (m.name) internalIds.add(m.name);
        }

        const targetModules = args.allModules
          ? modules
          : args.moduleId
            ? modules.filter(
                (m) =>
                  m.id.toLowerCase() === String(args.moduleId).toLowerCase() ||
                  m.relPath.toLowerCase() === String(args.moduleId).toLowerCase() ||
                  m.path.toLowerCase().endsWith(String(args.moduleId).toLowerCase()),
              )
            : [modules[0]!];

        if (targetModules.length === 0) {
          throw new Error(`Module '${args.moduleId}' not found.`);
        }

        const results: any[] = [];
        let totalCount = 0;

        for (const mod of targetModules) {
          const updates = await strategy.reader.scan(mod, config.excludeScopes, internalIds, channel);
          totalCount += updates.length;
          results.push({
            moduleId: mod.id,
            modulePath: mod.relPath,
            updateCount: updates.length,
            updates: updates.map((u) => ({
              identifier: u.coordinate.identifier,
              currentRange: u.currentRange,
              currentClean: u.currentClean,
              latest: u.latest,
              newRange: u.newRange,
              diff: u.diff,
              scope: u.scope,
              isPreRelease: u.isPreRelease ?? false,
              preReleaseTag: u.preReleaseTag,
            })),
          });
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ecosystem,
                  channel,
                  scannedModules: targetModules.length,
                  totalUpdatesCount: totalCount,
                  results,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── Tool 3: elevate_get_versions ──
      if (name === 'elevate_get_versions') {
        const identifier = String(args.identifier);
        let coordinate;
        if (ecosystem === 'maven') {
          const parts = identifier.split(':');
          coordinate = {
            identifier,
            group: parts[0],
            artifact: parts[1] || parts[0]!,
            ecosystem: 'maven' as const,
          };
        } else {
          coordinate = {
            identifier,
            artifact: identifier,
            ecosystem: 'npm' as const,
          };
        }

        const versions = await strategy.registry.getAllVersions(coordinate);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ecosystem,
                  package: identifier,
                  totalCount: versions.length,
                  latest: versions[0] || null,
                  versions: versions.map((v) => ({
                    version: v,
                    isPreRelease: isPreReleaseVersion(v),
                    tag: extractPreReleaseTag(v),
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── Tool 4: elevate_apply_updates ──
      if (name === 'elevate_apply_updates') {
        const modules = await strategy.discovery.discover(config.rootDir);
        const mod = modules.find(
          (m) =>
            m.id.toLowerCase() === String(args.moduleId).toLowerCase() ||
            m.relPath.toLowerCase() === String(args.moduleId).toLowerCase() ||
            m.path.toLowerCase().endsWith(String(args.moduleId).toLowerCase()),
        );

        if (!mod) {
          throw new Error(`Module '${args.moduleId}' not found.`);
        }

        const internalIds = new Set<string>();
        for (const m of modules) {
          if (m.id) internalIds.add(m.id);
          if (m.name) internalIds.add(m.name);
        }

        const availableUpdates = await strategy.reader.scan(mod, config.excludeScopes, internalIds, 'stable');
        const requestedUpdates = (args.updates as { identifier: string; targetVersion?: string }[]) || [];
        const updatesToApply: UpdateCandidate[] = [];

        for (const req of requestedUpdates) {
          const found = availableUpdates.find((u) => u.coordinate.identifier === req.identifier);
          if (found) {
            const targetVer = req.targetVersion || found.latest;
            const prefix = found.currentRange.startsWith('~') ? '~' : found.currentRange.startsWith('^') ? '^' : '';
            const diff: VersionDiff = semver.valid(targetVer) && found.currentClean
              ? (semver.diff(found.currentClean, targetVer) as VersionDiff) || 'minor'
              : found.diff;

            if (diff === 'major' && !args.allowMajor) {
              throw new Error(
                `Major update for '${req.identifier}' to ${targetVer} rejected. Set 'allowMajor: true' to permit breaking changes.`,
              );
            }

            updatesToApply.push({
              ...found,
              newRange: `${prefix}${targetVer}`,
              diff,
              selected: true,
            });
          } else if (req.targetVersion) {
            updatesToApply.push({
              coordinate: {
                identifier: req.identifier,
                artifact: req.identifier,
                ecosystem,
              },
              currentRange: 'unknown',
              currentClean: '0.0.0',
              latest: req.targetVersion,
              newRange: req.targetVersion,
              diff: 'minor',
              scope: 'prod',
              selected: true,
            });
          }
        }

        if (args.dryRun) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    dryRun: true,
                    targetModule: mod.relPath,
                    ecosystem,
                    updatesCount: updatesToApply.length,
                    updates: updatesToApply.map((u) => ({
                      identifier: u.coordinate.identifier,
                      currentRange: u.currentRange,
                      newRange: u.newRange,
                      diff: u.diff,
                    })),
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        const updateResult = await strategy.updater.applyUpdates(mod, config.rootDir, updatesToApply, () => {});

        let verifyResult;
        if (!args.skipVerification) {
          verifyResult = await strategy.verifier.verify(
            mod,
            config.rootDir,
            config.postUpdateScript,
            config.postUpdateLabel,
          );
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: verifyResult?.status !== 'warn',
                  targetModule: mod.relPath,
                  ecosystem,
                  ...updateResult,
                  verification: verifyResult,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── Tool 5: elevate_verify ──
      if (name === 'elevate_verify') {
        const modules = await strategy.discovery.discover(config.rootDir);
        const mod = args.moduleId
          ? modules.find(
              (m) =>
                m.id.toLowerCase() === String(args.moduleId).toLowerCase() ||
                m.relPath.toLowerCase() === String(args.moduleId).toLowerCase() ||
                m.path.toLowerCase().endsWith(String(args.moduleId).toLowerCase()),
            )
          : modules[0];

        if (!mod) {
          throw new Error(`Module '${args.moduleId || 'default'}' not found.`);
        }

        const verifyResult = await strategy.verifier.verify(
          mod,
          config.rootDir,
          config.postUpdateScript,
          config.postUpdateLabel,
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  module: mod.relPath,
                  ecosystem,
                  ...verifyResult,
                },
                null,
                2,
              ),
            },
          ],
        };
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
