import { join } from 'node:path';

// Which agent.env a process reads and `tarfa setup` writes: TARFA_AGENT_ENV, then the one in the
// state directory, then (a source checkout only) the checkout's own deploy/agent.env. The service's
// launcher sources the state-directory file, so an adopted machine's CLI reads what the service
// reads even when it runs from a checkout that still holds the original. With no checkout there is
// no third candidate and a missing file is named where setup creates it.
export function resolveAgentEnvPath(input: {
  env: { TARFA_AGENT_ENV?: string };
  home: string;
  checkout: string | null;
  exists: (path: string) => boolean;
}): string {
  if (input.env.TARFA_AGENT_ENV) return input.env.TARFA_AGENT_ENV;
  const stateFile = join(input.home, '.tarfa', 'agent.env');
  if (input.exists(stateFile) || input.checkout === null) return stateFile;
  return join(input.checkout, 'deploy', 'agent.env');
}
