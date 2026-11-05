import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

export default defineConfig({
  entry: {
    cli: 'src/index.tsx',
  },
  format: ['esm'],
  target: 'node22',
  clean: true,
  sourcemap: true,
  shims: true,
  define: { __ELEVATE_VERSION__: JSON.stringify(version) },
});

