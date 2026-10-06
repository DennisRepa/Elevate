import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { findRepositoryRoot, loadConfig } from '../../src/config.js';
import { MavenModuleDiscoveryAdapter } from '../../src/adapters/maven/maven-discovery.js';
import { cleanupTemp, makeTree, pom } from '../helpers.js';

afterEach(cleanupTemp);

/** A tree whose top directory is the root of a (fake) checkout, as the feature's Background requires. */
function tree(files: Record<string, string>, options: { git?: boolean } = {}): string {
  return makeTree({ ...(options.git === false ? {} : { '.git/HEAD': 'ref: refs/heads/main\n' }), ...files });
}

const gav = (g: string, a: string, v = '1') => `<groupId>${g}</groupId><artifactId>${a}</artifactId><version>${v}</version>`;
const parent = (g: string, a: string, v = '1', relativePath = '') =>
  `<parent><groupId>${g}</groupId><artifactId>${a}</artifactId><version>${v}</version>${relativePath}</parent>`;
const modules = (...names: string[]) => `<modules>${names.map((n) => `<module>${n}</module>`).join('')}</modules>`;

describe('repository root detection', () => {
  it('ROOT-10 Markers above the checkout are ignored', () => {
    const root = tree(
      {
        'elevate.config.json': '{"internalScopes": ["@outer"]}',
        'package.json': '{"name": "outer", "workspaces": ["checkout/*"]}',
        'checkout/.git/HEAD': 'ref: refs/heads/main\n',
        'checkout/app/package.json': '{"name": "app", "version": "1.0.0"}',
      },
      { git: false },
    );
    expect(findRepositoryRoot(join(root, 'checkout', 'app'))).toBe(join(root, 'checkout', 'app'));
  });

  it('ROOT-01 A configuration file in an ancestor directory marks the root', () => {
    const root = tree({
      'elevate.config.json': '{"internalScopes": ["com.acme"]}',
      'services/billing/pom.xml': pom(gav('com.acme', 'billing', '1.0.0')),
    });
    expect(findRepositoryRoot(join(root, 'services', 'billing'))).toBe(root);
  });

  it('ROOT-02 The nearest configuration file wins', () => {
    const root = tree({
      'elevate.config.json': '{}',
      'frontend/elevate.config.json': '{}',
      'frontend/package.json': '{"name": "frontend", "version": "1.0.0"}',
    });
    mkdirSync(join(root, 'frontend', 'src'));
    expect(findRepositoryRoot(join(root, 'frontend', 'src'))).toBe(join(root, 'frontend'));
  });

  it('ROOT-12 The configuration of the detected root is applied when started in a submodule', () => {
    const root = tree({
      'elevate.config.json': '{"internalScopes": ["com.acme"], "channel": "all"}',
      'pom.xml': pom(gav('com.acme', 'parent', '1.0.0') + '<packaging>pom</packaging>' + modules('core')),
      'core/pom.xml': pom(parent('com.acme', 'parent', '1.0.0') + '<artifactId>core</artifactId>'),
    });
    const config = loadConfig(join(root, 'core'));
    expect(config.rootDir).toBe(root);
    expect(config.internalScopes).toEqual(['com.acme']);
    expect(config.channel).toBe('all');
  });

  it('ROOT-03 An npm workspace package resolves to the workspace root', () => {
    const root = tree({
      'package.json': '{"name": "mono", "workspaces": ["packages/*"]}',
      'packages/core/package.json': '{"name": "core", "version": "1.0.0"}',
    });
    expect(findRepositoryRoot(join(root, 'packages', 'core'))).toBe(root);
  });

  it('ROOT-04 A Maven submodule resolves to the reactor root', async () => {
    const root = tree({
      'pom.xml': pom(gav('org.example', 'parent', '1.0.0') + '<packaging>pom</packaging>' + modules('core', 'app')),
      'core/pom.xml': pom(parent('org.example', 'parent', '1.0.0') + '<artifactId>core</artifactId>'),
      'app/pom.xml': pom(parent('org.example', 'parent', '1.0.0') + '<artifactId>app</artifactId>'),
    });
    const detected = findRepositoryRoot(join(root, 'core'));
    expect(detected).toBe(root);
    const found = await new MavenModuleDiscoveryAdapter().discover(detected);
    expect(found.map((m) => m.relPath)).toEqual(['Root', 'app', 'core']);
  });

  it('ROOT-05 Nested aggregators are climbed to the outermost one', () => {
    const root = tree({
      'pom.xml': pom(gav('g', 'top') + '<packaging>pom</packaging>' + modules('platform')),
      'platform/pom.xml': pom(
        parent('g', 'top', '1', '<relativePath/>') +
          '<artifactId>platform</artifactId><version>1</version><packaging>pom</packaging>' +
          modules('services/billing'),
      ),
      'platform/services/billing/pom.xml': pom(gav('g', 'billing')),
    });
    expect(findRepositoryRoot(join(root, 'platform', 'services', 'billing'))).toBe(root);
  });

  it('ROOT-06 A child that inherits from the POM above without being listed as a module still resolves to it', () => {
    const root = tree({
      'pom.xml': pom(gav('g', 'parent') + '<packaging>pom</packaging>'),
      'tool/pom.xml': pom(parent('g', 'parent') + '<artifactId>tool</artifactId>'),
    });
    expect(findRepositoryRoot(join(root, 'tool'))).toBe(root);
  });

  it('ROOT-07 A project that opts out of the local parent and is not aggregated stays its own root', () => {
    const root = tree({
      'pom.xml': pom(gav('g', 'parent') + '<packaging>pom</packaging>'),
      'tool/pom.xml': pom(parent('g', 'parent', '1', '<relativePath/>') + '<artifactId>tool</artifactId>'),
    });
    expect(findRepositoryRoot(join(root, 'tool'))).toBe(join(root, 'tool'));
  });

  it('ROOT-08 An unrelated pom.xml in the directory above is not a root', () => {
    const root = tree({
      'pom.xml': pom(gav('other', 'thing')),
      'tool/pom.xml': pom(gav('g', 'tool')),
    });
    expect(findRepositoryRoot(join(root, 'tool'))).toBe(join(root, 'tool'));
  });

  it('ROOT-09 The outermost proposal wins when both ecosystems propose a root', () => {
    const root = tree({
      'package.json': '{"name": "mono", "workspaces": ["frontend/*"]}',
      'backend/pom.xml': pom(gav('g', 'backend') + '<packaging>pom</packaging>' + modules('service')),
      'backend/service/pom.xml': pom(parent('g', 'backend') + '<artifactId>service</artifactId>'),
    });
    expect(findRepositoryRoot(join(root, 'backend', 'service'))).toBe(root);
  });

  it('ROOT-13 Unreadable manifests on the way up are skipped', () => {
    const root = tree({
      'package.json': '{"name": "mono", "workspaces": ["packages/*"]}',
      'packages/package.json': '{ this is not JSON',
      'packages/pom.xml': '<project><unclosed>',
      'packages/core/package.json': '{"name": "core", "version": "1.0.0"}',
      'packages/core/pom.xml': pom(gav('g', 'core')),
    });
    let detected: string | undefined;
    expect(() => (detected = findRepositoryRoot(join(root, 'packages', 'core')))).not.toThrow();
    expect(detected).toBe(root);
  });

  it('ROOT-11 A plain project is its own root', () => {
    const root = tree({ 'project/package.json': '{"name": "plain", "version": "1.0.0"}' });
    expect(findRepositoryRoot(join(root, 'project'))).toBe(join(root, 'project'));
  });
});
