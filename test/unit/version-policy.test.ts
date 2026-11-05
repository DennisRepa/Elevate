import { describe, expect, it } from 'vitest';
import { EcosystemFactory } from '../../src/domain/ecosystem-factory.js';

const policy = (e: 'npm' | 'maven') => EcosystemFactory.getStrategy(e).versioning;

describe('version policies', () => {
  it('npm keeps the range operator and allows manual targets', () => {
    expect(policy('npm').rewrite('^1.2.0', '1.5.0')).toBe('^1.5.0');
    expect(policy('npm').rewrite('~1.2.0', '1.5.0')).toBe('~1.5.0');
    expect(policy('npm').rewrite('1.2.0', '1.5.0')).toBe('1.5.0');
    expect(policy('npm').normalize('1.5.0')).toBe('1.5.0');
    expect(policy('npm').diff('1.2.0', '2.0.0')).toBe('major');
    expect(policy('npm').diff('1.2.0', '1.2.0')).toBe('patch');
    expect(policy('npm').allowsManualTargets).toBe(true);
  });

  it('maven writes the version as is and normalises Java versions', () => {
    expect(policy('maven').rewrite('5.10.2', '5.11.0')).toBe('5.11.0');
    expect(policy('maven').normalize('1.71.0.Final')).toBe('1.71.0');
    expect(policy('maven').diff('5.10.2', '6.0.0.Final')).toBe('major');
    expect(policy('maven').allowsManualTargets).toBe(false);
  });
});
