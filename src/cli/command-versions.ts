/**
 * 🪶 Elevate — CLI Command: `versions`
 *
 * Retrieves the full version release history of a package from the registry.
 */

import type { CliOptions } from './parser.js';
import { EcosystemFactory } from '../domain/ecosystem-factory.js';
import { isPreReleaseVersion, extractPreReleaseTag } from '../adapters/maven/maven-registry.js';

export async function handleVersionsCommand(options: CliOptions): Promise<number> {
  const pkgIdentifier = options.positional;
  if (!pkgIdentifier) {
    console.error('❌ Error: Please specify a package name (e.g. `elevate versions chalk`).');
    return 1;
  }

  // Determine ecosystem: if contains ':' -> default to Maven, otherwise npm
  const ecosystem = options.ecosystem ?? (pkgIdentifier.includes(':') ? 'maven' : 'npm');
  const strategy = EcosystemFactory.getStrategy(ecosystem);

  let coordinate;
  if (ecosystem === 'maven') {
    const parts = pkgIdentifier.split(':');
    coordinate = {
      identifier: pkgIdentifier,
      group: parts[0],
      artifact: parts[1] || parts[0]!,
      ecosystem: 'maven' as const,
    };
  } else {
    coordinate = {
      identifier: pkgIdentifier,
      artifact: pkgIdentifier,
      ecosystem: 'npm' as const,
    };
  }

  const versions = await strategy.registry.getAllVersions(coordinate);

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

  console.log(`\n🪶 Published versions for '${pkgIdentifier}' (${strategy.icon} ${strategy.displayName}, ${versions.length} total):\n`);
  for (const v of versions.slice(0, 30)) {
    const isPre = isPreReleaseVersion(v);
    const tag = isPre ? `[${extractPreReleaseTag(v) || 'PRE'}]` : '[STABLE]';
    console.log(`  • ${v.padEnd(25)} ${tag}`);
  }
  if (versions.length > 30) {
    console.log(`  … and ${versions.length - 30} older versions.\n`);
  } else {
    console.log('');
  }

  return 0;
}
