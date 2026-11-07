// The oldest agent release this app still works with. Raised by the release that first changes
// the protocol incompatibly, never ahead of the oldest agent a phone may pair with.
export const MIN_AGENT_VERSION = '0.0.0';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parse(version: string): { core: number[]; pre: string | undefined } | null {
  const m = SEMVER.exec(version);
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] };
}

function compare(a: NonNullable<ReturnType<typeof parse>>, b: NonNullable<ReturnType<typeof parse>>): number {
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i]! < b.core[i]! ? -1 : 1;
  if (a.pre === b.pre) return 0;
  if (a.pre === undefined) return 1;
  if (b.pre === undefined) return -1;
  return a.pre < b.pre ? -1 : 1;
}

// An agent that reports no version predates the field and reads as 0.0.0; a version that is not
// semver is never held against the agent.
export function agentTooOld(version: string | undefined, minimum: string = MIN_AGENT_VERSION): boolean {
  const have = parse(version ?? '0.0.0');
  const need = parse(minimum);
  if (!have || !need) return false;
  return compare(have, need) < 0;
}
