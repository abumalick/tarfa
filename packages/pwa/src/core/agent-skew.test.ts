import { describe, expect, it } from 'vitest';
import { MIN_AGENT_VERSION, agentTooOld } from './agent-skew';

describe('agentTooOld', () => {
  it('flags nobody at the shipped minimum, a missing version included', () => {
    expect(MIN_AGENT_VERSION).toBe('0.0.0');
    expect(agentTooOld(undefined)).toBe(false);
    expect(agentTooOld('0.1.0')).toBe(false);
  });

  it('reads a missing version as 0.0.0', () => {
    expect(agentTooOld(undefined, '0.1.0')).toBe(true);
    expect(agentTooOld(undefined, '0.0.0')).toBe(false);
  });

  it('is too old only strictly below the minimum', () => {
    expect(agentTooOld('0.1.0', '0.1.0')).toBe(false);
    expect(agentTooOld('0.0.9', '0.1.0')).toBe(true);
    expect(agentTooOld('0.2.0', '0.1.0')).toBe(false);
    expect(agentTooOld('1.0.0', '0.10.0')).toBe(false);
    expect(agentTooOld('0.9.0', '0.10.0')).toBe(true);
  });

  it('orders a prerelease before its release', () => {
    expect(agentTooOld('0.1.0-beta.1', '0.1.0')).toBe(true);
    expect(agentTooOld('0.1.0', '0.1.0-beta.1')).toBe(false);
  });

  it('never flags a malformed version', () => {
    expect(agentTooOld('banana', '0.1.0')).toBe(false);
    expect(agentTooOld('1.2', '0.1.0')).toBe(false);
    expect(agentTooOld('0.1.0', 'banana')).toBe(false);
  });
});
