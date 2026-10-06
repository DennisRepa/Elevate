import { defineConfig } from 'vitest/config';

// Integration tests: run real Maven and npm against the fixtures.
// They need Maven (or a wrapper), network access to the configured repositories, and time.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.{ts,tsx}'],
    testTimeout: 10 * 60_000,
    hookTimeout: 10 * 60_000,
    fileParallelism: false,
  },
});
