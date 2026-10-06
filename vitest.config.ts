import { defineConfig } from 'vitest/config';

// Unit tests: fast, offline, no Maven or npm registry access.
export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.{ts,tsx}'],
    testTimeout: 20_000,
  },
});
