/**
 * Drives the interactive dashboard with keystrokes against the npm fixture,
 * using real npm lookups: splash → module selector → `apps/web` → scan.
 */

import { expect, it } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { join } from 'node:path';
import { App } from '../../src/app.js';
import { resolveConfig } from '../../src/config.js';
import { FIXTURES } from '../helpers.js';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the dashboard');
    await pause(200);
  }
}

it('shows workspace alignment and the skipped internal package in the dashboard', async () => {
  const config = resolveConfig(join(FIXTURES, 'npm-workspaces'), { internalScopes: ['@acme'], locale: 'en' });
  const { lastFrame, stdin, unmount } = render(<App config={config} />);

  await pause(300);
  stdin.write(' '); // leave the splash screen
  await pause(300);
  stdin.write('w'); // open the module selector
  await pause(200);
  stdin.write('j'); // Root → apps/web
  await pause(200);
  stdin.write('\r');

  await waitFor(() => (lastFrame() ?? '').includes('[Align]'), 60_000);
  const frame = lastFrame() ?? '';
  expect(frame).toContain('@acme/core');
  expect(frame).toContain('@acme/secret-sdk: internal package, but its registry is public');
  unmount();
});
