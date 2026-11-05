import { describe, expect, it } from 'vitest';
import {
  cargoDiff,
  isUpgradableRequirement,
  requirementFloor,
  rewriteRequirement,
  satisfiesRequirement,
} from '../../src/adapters/cargo/cargo-requirement.js';

describe('Cargo version requirements', () => {
  it('CREQ-01 a bare version means caret, not exact', () => {
    expect(satisfiesRequirement('1.2.3', '1.9.0')).toBe(true);
    expect(satisfiesRequirement('1.2.3', '2.0.0')).toBe(false);
    expect(satisfiesRequirement('0.2.3', '0.2.9')).toBe(true);
    expect(satisfiesRequirement('0.2.3', '0.3.0')).toBe(false);
    expect(satisfiesRequirement('0.0.3', '0.0.4')).toBe(false);
    expect(satisfiesRequirement('=1.2.3', '1.2.4')).toBe(false);
    expect(satisfiesRequirement('~1.2', '1.2.9')).toBe(true);
    expect(satisfiesRequirement('~1.2', '1.3.0')).toBe(false);
    expect(satisfiesRequirement('>=1.2, <2', '1.9.0')).toBe(true);
  });

  it.each([
    ['1.0.100', '1.0.229', '1.0.229'],
    ['1.0', '2.3.4', '2.3'],
    ['1', '2.3.4', '2'],
    ['0.4', '1.0.18', '1.0'],
    ['0.4.10', '0.5.1', '0.5.1'],
    ['~1.8.0', '1.9.2', '~1.9.2'],
    ['^1.2', '1.4.0', '^1.4'],
    ['=1.0.0', '1.0.5', '=1.0.5'],
    ['1', '2.0.0-rc.1', '2.0.0-rc.1'],
  ])('CREQ-02 %s -> %s keeps precision and operator: %s', (current, target, expected) => {
    expect(rewriteRequirement(current, target)).toBe(expected);
  });

  it('CREQ-10 a loose requirement that already allows the target is left unchanged', () => {
    expect(rewriteRequirement('1', '1.0.18')).toBe('1');
  });

  it.each(['*', '1.*', '>=1.2, <2', '<2', '', '>1'])('CREQ-04 %j is not upgradable', (req) => {
    expect(isUpgradableRequirement(req)).toBe(false);
  });

  it.each(['1', '1.2', '1.2.3', '^1.2', '~1.2.3', '=1.2.3', '0.4'])('CREQ-04 %j is upgradable', (req) => {
    expect(isUpgradableRequirement(req)).toBe(true);
  });

  it('CREQ-03 the floor is the lowest version the requirement allows', () => {
    expect(requirementFloor('1')).toBe('1.0.0');
    expect(requirementFloor('~1.8.0')).toBe('1.8.0');
    expect(requirementFloor('0.4.10')).toBe('0.4.10');
  });

  it.each([
    ['1.2.3', '1.2.4', 'patch'],
    ['1.2.3', '1.3.0', 'minor'],
    ['1.2.3', '2.0.0', 'major'],
    ['0.4.2', '0.4.3', 'minor'],
    ['0.4.2', '0.5.0', 'major'],
    ['0.4.2', '1.0.0', 'major'],
    ['0.0.3', '0.0.4', 'major'],
  ])('CREQ-06 %s -> %s is %s by Cargo compatibility', (from, to, expected) => {
    expect(cargoDiff(from, to)).toBe(expected);
  });
});
