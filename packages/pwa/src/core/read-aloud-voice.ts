// Which voice reads a reply aloud: the phone's own, or ElevenLabs with the attached machine's key.
export type ReadAloudSource = 'device' | 'elevenlabs';

export interface ElevenLabsVoice {
  id: string;
  name: string;
}

export interface ReadAloudVoiceChoice {
  source: ReadAloudSource;
  // The ElevenLabs voice picked in Settings; null reads with the default.
  voice: ElevenLabsVoice | null;
}

// A premade voice every ElevenLabs account has, verified for English, French and Arabic.
export const DEFAULT_ELEVENLABS_VOICE: ElevenLabsVoice = { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George' };

// What one tap may send to ElevenLabs: it bounds the credits a single reading spends, and a longer
// reply reads with the phone's voice instead.
export const ELEVENLABS_MAX_CHARS = 10_000;

export const READ_ALOUD_BADGES: Record<ReadAloudSource, string> = { device: '📱', elevenlabs: 'EL' };

export const DEFAULT_READ_ALOUD_VOICE: ReadAloudVoiceChoice = { source: 'device', voice: null };

export function parseReadAloudVoice(raw: string | null): ReadAloudVoiceChoice {
  if (!raw) return DEFAULT_READ_ALOUD_VOICE;
  try {
    const value = JSON.parse(raw) as { source?: unknown; voice?: { id?: unknown; name?: unknown } | null };
    const source: ReadAloudSource = value.source === 'elevenlabs' ? 'elevenlabs' : 'device';
    const v = value.voice;
    const voice = v && typeof v.id === 'string' && v.id && typeof v.name === 'string' ? { id: v.id, name: v.name } : null;
    return { source, voice };
  } catch {
    return DEFAULT_READ_ALOUD_VOICE;
  }
}

// ElevenLabs only when the attached machine holds a key; otherwise a tap reads with the phone.
export function effectiveSource(choice: ReadAloudVoiceChoice, hasKey: boolean): ReadAloudSource {
  return choice.source === 'elevenlabs' && hasKey ? 'elevenlabs' : 'device';
}

export function elevenLabsVoice(choice: ReadAloudVoiceChoice): ElevenLabsVoice {
  return choice.voice ?? DEFAULT_ELEVENLABS_VOICE;
}
