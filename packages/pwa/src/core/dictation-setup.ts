import { needsKey, type DictationPreset, type DictationProvider, type PresetKeys } from './dictation-presets';

// What the mic's setup explanation offers when no preset can run here: one entry per way of
// unlocking a preset in the user's own list, so it never suggests a key nothing would use.
export type SetupOption =
  | { kind: 'key'; provider: DictationProvider }
  // `setup`: the machine cannot play Claude voice (macOS, Linux without the loopback, an agent
  // too old to say: the phone cannot tell them apart). Otherwise the machine can, and the
  // state is why this workspace cannot.
  | { kind: 'claude'; state: 'setup' | 'not-claude' | 'asking' };

export function setupOptions(presets: readonly DictationPreset[], keys: PresetKeys): SetupOption[] {
  const options: SetupOption[] = [];
  const seen = new Set<string>();
  for (const p of presets) {
    if (seen.has(p.provider) || !needsKey(p, keys)) continue;
    seen.add(p.provider);
    if (p.provider === 'claude') {
      const state = keys.claude === 'not-claude' || keys.claude === 'asking' ? keys.claude : 'setup';
      options.push({ kind: 'claude', state });
    } else options.push({ kind: 'key', provider: p.provider });
  }
  return options;
}

export const CLAUDE_VOICE_DOCS_URL =
  'https://github.com/abumalick/tarfa/blob/main/docs/SETUP-MACHINE.md#11-optional-dictate-through-claude-codes-own-voice-linux';

export const PROVIDER_NAMES: Record<DictationProvider, string> = { elevenlabs: 'ElevenLabs', openrouter: 'OpenRouter' };

export const PROVIDER_LINKS: Record<DictationProvider, { keys: string; pricing: string }> = {
  elevenlabs: { keys: 'https://elevenlabs.io/app/developers/api-keys', pricing: 'https://elevenlabs.io/pricing/api' },
  openrouter: { keys: 'https://openrouter.ai/settings/keys', pricing: 'https://openrouter.ai/models' },
};
