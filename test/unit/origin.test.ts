import { describe, expect, it } from 'vitest';
import { buildWorkspaceIndex, classifyOrigin, matchesInternalScope } from '../../src/domain/origin.js';
import type { ProjectModule } from '../../src/domain/models.js';

const module = (id: string): ProjectModule => ({
  id,
  name: id,
  path: `/repo/${id}`,
  relPath: id,
  ecosystem: 'npm',
  isRoot: false,
  version: '1.0.0',
});

describe('matchesInternalScope', () => {
  it('matches npm scopes with or without trailing slash', () => {
    expect(matchesInternalScope('@acme/core', 'npm', ['@acme'])).toBe(true);
    expect(matchesInternalScope('@acme/core', 'npm', ['@acme/'])).toBe(true);
    expect(matchesInternalScope('@acmecorp/core', 'npm', ['@acme'])).toBe(false);
  });

  it('matches exact npm names and explicit prefixes', () => {
    expect(matchesInternalScope('acme-utils', 'npm', ['acme-utils'])).toBe(true);
    expect(matchesInternalScope('acme-utils-extra', 'npm', ['acme-utils'])).toBe(false);
    expect(matchesInternalScope('acme-utils-extra', 'npm', ['acme-*'])).toBe(true);
  });

  it('matches Maven groupIds on segment boundaries only', () => {
    expect(matchesInternalScope('com.acme:core', 'maven', ['com.acme'])).toBe(true);
    expect(matchesInternalScope('com.acme.billing:api', 'maven', ['com.acme'])).toBe(true);
    expect(matchesInternalScope('com.acmecorp:api', 'maven', ['com.acme'])).toBe(false);
  });

  it('ignores a leading @ for Maven so one list serves both ecosystems', () => {
    expect(matchesInternalScope('acme:core', 'maven', ['@acme'])).toBe(true);
  });
});

describe('classifyOrigin', () => {
  const workspace = buildWorkspaceIndex([module('@acme/core')]);

  it('prefers workspace modules over internal scopes', () => {
    const origin = classifyOrigin('@acme/core', 'npm', { workspace, internalScopes: ['@acme'] });
    expect(origin.kind).toBe('workspace');
  });

  it('classifies configured scopes as private', () => {
    const origin = classifyOrigin('@acme/sdk', 'npm', { workspace, internalScopes: ['@acme'] });
    expect(origin).toEqual({ kind: 'private', matchedBy: 'internal-scope' });
  });

  it('classifies explicit scoped registry mappings as private', () => {
    const origin = classifyOrigin('@corp/lib', 'npm', {
      workspace,
      internalScopes: [],
      scopedRegistries: new Map([['@corp', 'https://nexus.corp/npm/']]),
    });
    expect(origin).toEqual({ kind: 'private', matchedBy: 'scoped-registry', registry: 'https://nexus.corp/npm/' });
  });

  it('treats everything else as public, even behind a private default registry', () => {
    expect(classifyOrigin('react', 'npm', { workspace, internalScopes: ['@acme'] }).kind).toBe('public');
  });
});
