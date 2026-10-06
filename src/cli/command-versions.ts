/**
 * Elevate — CLI command: `versions`
 *
 * Retrieves the published version history of a package from the registry.
 */

import type { CliOptions } from './parser.js';
import type { ElevateConfig } from '../config.js';
import { EcosystemFactory } from '../domain/ecosystem-factory.js';
import { isPreReleaseVersion, extractPreReleaseTag } from '../domain/versions.js';
import { coordinateFromIdentifier, lookupVersions } from '../application/version-lookup.js';

export async function handleVersionsCommand(options: CliOptions, config: ElevateConfig): Promise<number> {
  const pkgIdentifier = options.positional;
  if (!pkgIdentifier) {
    console.error('❌ Error: Please specify a package name (e.g. `elevate versions chalk`).');
    return 1;
  }

  // An identifier containing ':' is a Maven coordinate unless stated otherwise.
  const ecosystem = options.ecosystem ?? (pkgIdentifier.includes(':') ? 'maven' : 'npm');
  const strategy = EcosystemFactory.getStrategy(ecosystem);
  const coordinate = coordinateFromIdentifier(pkgIdentifier, ecosystem);

  let versions: string[];
  try {
    versions = await lookupVersions(strategy, coordinate, config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) console.log(JSON.stringify({ error: message, package: pkgIdentifier }, null, 2));
    else console.error(`❌ ${message}`);
    return 1;
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          ecosystem,
          package: pkgIdentifier,
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
    );
    return 0;
  }

  console.log(
    `\n🪶 Published versions for '${pkgIdentifier}' (${strategy.icon} ${strategy.displayName}, ${versions.length} total):\n`,
  );
  for (const v of versions.slice(0, 30)) {
    const tag = isPreReleaseVersion(v) ? `[${extractPreReleaseTag(v) || 'PRE'}]` : '[STABLE]';
    console.log(`  • ${v.padEnd(25)} ${tag}`);
  }
  console.log(versions.length > 30 ? `  … and ${versions.length - 30} older versions.\n` : '');

  return 0;
}
