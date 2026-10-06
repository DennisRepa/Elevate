import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ConfigError, loadConfig } from '../../src/config.js';
import { cleanupTemp, makeTree } from '../helpers.js';

afterEach(cleanupTemp);

const PACKAGE = '{"name": "root", "version": "1.0.0"}';

/** A checkout whose elevate.config.json has the given raw content (or none). */
function repository(config: string | undefined): string {
  return makeTree({
    '.git/HEAD': 'ref: refs/heads/main',
    'package.json': PACKAGE,
    ...(config === undefined ? {} : { 'elevate.config.json': config }),
  });
}

function loadFailure(config: string): ConfigError {
  const root = repository(config);
  try {
    loadConfig(root);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return err as ConfigError;
  }
  throw new Error('loadConfig did not fail');
}

describe('the file must be a JSON object', () => {
  it('CONF-01 Invalid JSON stops Elevate with the location of the problem', () => {
    const root = repository('{ "internalScopes": ["@acme"');
    let failure: unknown;
    try {
      loadConfig(root);
    } catch (err) {
      failure = err;
    }
    expect(failure).toBeInstanceOf(ConfigError);
    const message = (failure as Error).message;
    expect(message.startsWith('Cannot read elevate.config.json:')).toBe(true);
    expect(message).toContain(join(root, 'elevate.config.json'));
    expect(message.endsWith('Fix the file or remove it; Elevate does not continue without your internalScopes.')).toBe(true);
  });

  it.each(['[]', '"internal"', '42', 'null', 'true'])(
    'CONF-02 A JSON value that is not an object stops Elevate: %s',
    (content) => {
      expect(loadFailure(content).message).toContain('must contain a JSON object');
    },
  );

  it('CONF-05 An empty file stops Elevate', () => {
    expect(loadFailure('').message.startsWith('Cannot read elevate.config.json:')).toBe(true);
  });

  it('CONF-05 A byte order mark does not make a valid file unreadable', () => {
    const root = repository('﻿{"internalScopes": ["@acme"]}');
    expect(loadConfig(root).internalScopes).toEqual(['@acme']);
  });
});

describe('internalScopes and excludeScopes must be lists of strings', () => {
  it.each(['"@acme"', '{"a": 1}', '["@acme", 3]', '5', 'null'])(
    'CONF-03 An internalScopes value of the wrong shape stops Elevate: %s',
    (value) => {
      const root = repository(`{"internalScopes": ${value}}`);
      let failure: unknown;
      try {
        loadConfig(root);
      } catch (err) {
        failure = err;
      }
      expect(failure).toBeInstanceOf(ConfigError);
      expect((failure as Error).message).toBe(
        `Invalid elevate.config.json (${join(root, 'elevate.config.json')}): \`internalScopes\` must be a list of strings, ` +
          'for example ["@my-org", "com.mycompany"]. Elevate does not continue without your internalScopes.',
      );
    },
  );

  it('CONF-06 The deprecated excludeScopes is checked the same way', () => {
    expect(loadFailure('{"excludeScopes": "@acme"}').message).toContain('`excludeScopes` must be a list of strings');
  });

  it('CONF-04 A correct file and a missing file still work', () => {
    expect(loadConfig(repository('{"internalScopes": ["@acme"]}')).internalScopes).toEqual(['@acme']);
    expect(loadConfig(repository(undefined)).internalScopes).toEqual([]);
  });
});
