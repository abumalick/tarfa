// The shape of each dictation provider's API key, checked before one is stored, so a key pasted
// in the wrong field or a stray piece of text is refused with a reason instead of failing at the
// first dictation. Lengths are minimums, not exact: a valid key wrongly refused has no way round.
// ElevenLabs keys are `sk_` + 48 hex today; accounts from before the prefix had 32 hex.
// OpenRouter keys are `sk-or-v1-` + 64 hex.
export type DictationKeyProvider = 'elevenlabs' | 'openrouter';
export type DictationKeyProblem = 'format' | 'other-provider';

const SHAPES: Record<DictationKeyProvider, RegExp[]> = {
  elevenlabs: [/^sk_[A-Za-z0-9]{32,}$/, /^[0-9a-f]{32}$/],
  openrouter: [/^sk-or-v\d+-[A-Za-z0-9]{32,}$/],
};

export function dictationKeyProblem(provider: DictationKeyProvider, key: string): DictationKeyProblem | null {
  if (SHAPES[provider].some((shape) => shape.test(key))) return null;
  const other: DictationKeyProvider = provider === 'elevenlabs' ? 'openrouter' : 'elevenlabs';
  return SHAPES[other].some((shape) => shape.test(key)) ? 'other-provider' : 'format';
}
