import * as esbuild from 'esbuild';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..');

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

await esbuild.build({
  entryPoints: [join(root, 'src/index.tsx')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  define: { __ELEVATE_VERSION__: JSON.stringify(version) },
  alias: {
    'react-devtools-core': join(__dirname, 'empty-shim.js'),
  },
  banner: {
    js: `import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);`,
  },
  outfile: join(root, 'dist/bundle.mjs'),
});

console.log('⚡️ Bundle built successfully: dist/bundle.mjs');
