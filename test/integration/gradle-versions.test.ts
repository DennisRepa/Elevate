import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compareGradleVersions, sortGradleVersions } from '../../src/adapters/gradle/gradle-versions.js';
import { runLookup } from '../../src/adapters/gradle/gradle-probe.js';
import { cleanupTemp, FIXTURES, makeTree } from '../helpers.js';

afterEach(cleanupTemp);

const gradleInstalled = spawnSync('gradle', ['--version'], { encoding: 'utf8' }).status === 0;

/** A deterministic scramble of the corpus, so the repository never lists it in order. */
function scrambled(versions: string[]): string[] {
  return versions.map((v, i) => ({ v, key: (i * 7919) % 211 })).sort((a, b) => a.key - b.key).map((e) => e.v);
}

describe.skipIf(!gradleInstalled)('Gradle version order against a real Gradle', () => {
  it('GRDVER-04 Gradle itself orders a corpus of version strings the way Elevate does', async () => {
    const corpus = readFileSync(join(FIXTURES, 'gradle-versions', 'versions-corpus.txt'), 'utf8').split('\n').filter(Boolean);
    const root = makeTree({
      'settings.gradle': "rootProject.name = 'ord'",
    });
    const repo = join(root, 'repo');
    mkdirSync(join(repo, 'ord', 't'), { recursive: true });
    const versions = scrambled(corpus).map((v) => `<version>${v}</version>`).join('');
    writeFileSync(
      join(repo, 'ord', 't', 'maven-metadata.xml'),
      `<metadata><groupId>ord</groupId><artifactId>t</artifactId><versioning><versions>${versions}</versions></versioning></metadata>`,
    );
    writeFileSync(join(root, 'build.gradle'), `repositories { maven { url = uri('${repo}') } }\n`);

    const results = await runLookup(root, root, {
      protocol: 1,
      publicRepositoryUrls: [],
      internalGroupPatterns: [],
      lookups: [{ id: 'L1', buildRoot: root, project: ':', kind: 'module', group: 'ord', name: 't' }],
    });
    const gradleOrder = results[0]!.versions;
    expect(results[0]!.error).toBeNull();
    expect(new Set(gradleOrder)).toEqual(new Set(corpus));

    // Every pair of neighbours in Gradle's order is in the same order, or equal, for Elevate.
    for (let i = 0; i + 1 < gradleOrder.length; i++) {
      const [newer, older] = [gradleOrder[i]!, gradleOrder[i + 1]!];
      expect(compareGradleVersions(newer, older), `${newer} before ${older}`).toBeGreaterThanOrEqual(0);
    }
    expect(sortGradleVersions(gradleOrder)).toHaveLength(corpus.length);
  }, 300_000);
});
