import { afterEach, describe, expect, it } from 'vitest';
import { MavenModuleDiscoveryAdapter } from '../../src/adapters/maven/maven-discovery.js';
import { cleanupTemp, makeTree, pom } from '../helpers.js';

afterEach(cleanupTemp);

const gav = (g: string, a: string, v = '1') => `<groupId>${g}</groupId><artifactId>${a}</artifactId><version>${v}</version>`;
const modules = (...names: string[]) => `<modules>${names.map((n) => `<module>${n}</module>`).join('')}</modules>`;
const childOf = (g: string, a: string, v: string, artifactId: string) =>
  `<parent><groupId>${g}</groupId><artifactId>${a}</artifactId><version>${v}</version></parent><artifactId>${artifactId}</artifactId>`;

/** The module ids Maven module discovery reports for a root, sorted. */
async function discovered(root: string): Promise<string[]> {
  return (await new MavenModuleDiscoveryAdapter().discover(root)).map((m) => m.id).sort();
}

describe('Maven module discovery', () => {
  it('DISC-05 A module listed in <modules> is found even inside a source tree', async () => {
    const root = makeTree({
      'pom.xml': pom(gav('g', 'parent') + '<packaging>pom</packaging>' + modules('src/tools')),
      'src/tools/pom.xml': pom(gav('g', 'tools')),
    });
    expect(await discovered(root)).toEqual(['g:parent', 'g:tools']);
  });

  it('DISC-01 A fixture POM under src/test/resources is not a module', async () => {
    const root = makeTree({
      'pom.xml': pom(gav('org.example', 'parent', '1.0.0') + '<packaging>pom</packaging>' + modules('core')),
      'core/pom.xml': pom(childOf('org.example', 'parent', '1.0.0', 'core')),
      'core/src/test/resources/sample/pom.xml': pom(gav('com.google.guava', 'guava', '1.0')),
    });
    expect(await discovered(root)).toEqual(['org.example:core', 'org.example:parent']);
  });

  it('DISC-02 Integration-test projects under src/it are not modules', async () => {
    const root = makeTree({
      'pom.xml': pom(gav('g', 'plugin')),
      'src/it/simple/pom.xml': pom(gav('g', 'it-simple')),
      'src/it/settings/nested/pom.xml': pom(gav('g', 'it-nested')),
    });
    expect(await discovered(root)).toEqual(['g:plugin']);
  });

  it('DISC-03 Projects next to a source tree are still found', async () => {
    const root = makeTree({
      'pom.xml': pom(gav('g', 'app')),
      'src/main/resources/archetype/pom.xml': pom(gav('g', 'template')),
      'tools/pom.xml': pom(gav('g', 'tools')),
    });
    expect(await discovered(root)).toEqual(['g:app', 'g:tools']);
  });

  it('DISC-04 A directory named src that is not a project\'s source tree is walked', async () => {
    const root = makeTree({
      'README.md': '',
      'src/backend/pom.xml': pom(gav('g', 'backend')),
      'src/frontend/package.json': '{"name": "frontend"}',
    });
    expect(await discovered(root)).toEqual(['g:backend']);
  });

  it.each(['node_modules', 'target', 'build', 'dist', 'out', '.cache'])(
    'DISC-06 POM files in %s are not modules',
    async (directory) => {
      const root = makeTree({
        'pom.xml': pom(gav('g', 'app')),
        [`${directory}/leftover/pom.xml`]: pom(gav('g', 'leftover')),
      });
      expect(await discovered(root)).toEqual(['g:app']);
    },
  );
});
