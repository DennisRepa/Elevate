import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/index.tsx',
  },
  format: ['esm'],
  target: 'node22',
  clean: true,
  sourcemap: true,
  shims: true,
});

