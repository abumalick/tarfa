import { describe, expect, it } from 'vitest';
import { resolveAgentEnvPath } from './agent-env-location';

const HOME = '/home/u';
const USER_ENV = '/home/u/.tarfa/agent.env';
const CHECKOUT_ENV = '/src/tarfa/deploy/agent.env';

function resolve(over: { env?: Record<string, string>; checkout?: string | null; present?: string[] }) {
  const present = new Set(over.present ?? []);
  return resolveAgentEnvPath({ env: over.env ?? {}, home: HOME, checkout: over.checkout ?? null, exists: (p) => present.has(p) });
}

describe('resolveAgentEnvPath', () => {
  it('takes TARFA_AGENT_ENV first, whether or not it exists', () => {
    expect(resolve({ env: { TARFA_AGENT_ENV: '/etc/x.env' }, checkout: '/src/tarfa', present: [USER_ENV, CHECKOUT_ENV] })).toBe('/etc/x.env');
  });

  it('then ~/.tarfa/agent.env when it exists, even beside a checkout file', () => {
    expect(resolve({ checkout: '/src/tarfa', present: [USER_ENV, CHECKOUT_ENV] })).toBe(USER_ENV);
  });

  it('then the checkout deploy/agent.env, existing or not', () => {
    expect(resolve({ checkout: '/src/tarfa', present: [CHECKOUT_ENV] })).toBe(CHECKOUT_ENV);
    expect(resolve({ checkout: '/src/tarfa' })).toBe(CHECKOUT_ENV);
  });

  it('has no third candidate without a checkout: a package install names ~/.tarfa/agent.env', () => {
    expect(resolve({ checkout: null })).toBe(USER_ENV);
  });

  it('ignores an empty TARFA_AGENT_ENV', () => {
    expect(resolve({ env: { TARFA_AGENT_ENV: '' }, present: [USER_ENV] })).toBe(USER_ENV);
  });
});
