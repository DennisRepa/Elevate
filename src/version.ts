/**
 * Elevate — the product version.
 *
 * Bundled builds get it injected at build time (`__ELEVATE_VERSION__`), because
 * no package.json lies next to a bundle or a standalone binary. From source it
 * is read from package.json.
 */

import { createRequire } from 'node:module';

declare const __ELEVATE_VERSION__: string | undefined;

function fromPackage(): string {
  try {
    return (createRequire(import.meta.url)('../package.json') as { version: string }).version;
  } catch {
    return '0.0.0';
  }
}

export const VERSION: string = typeof __ELEVATE_VERSION__ === 'string' ? __ELEVATE_VERSION__ : fromPackage();
