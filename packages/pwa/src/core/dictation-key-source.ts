import type { DictationProvider } from './dictation-presets';

// The keys a machine's agent hands this phone, held in memory for the session only.
export type AgentDictationKeys = Partial<Record<DictationProvider, string>>;

// A key typed on this device wins everywhere. Otherwise only the attached workspace's machine
// counts: machines one phone reaches may have different operators, and a dictation into one must
// not be billed to another's account.
export function dictationKey(
  provider: DictationProvider,
  typed: string,
  activeMachineId: string | null,
  fromAgents: Record<string, AgentDictationKeys>,
): string | null {
  const own = typed.trim();
  if (own) return own;
  return (activeMachineId && fromAgents[activeMachineId]?.[provider]) || null;
}

export function dictationKeySources(
  provider: DictationProvider,
  machines: readonly { id: string; name: string }[],
  fromAgents: Record<string, AgentDictationKeys>,
): string[] {
  return machines.filter((m) => fromAgents[m.id]?.[provider]).map((m) => m.name);
}
