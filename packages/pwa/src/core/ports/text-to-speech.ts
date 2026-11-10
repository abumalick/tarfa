// A text-to-speech provider (ElevenLabs), faked in tests. A failure is a SynthesisError whose kind
// the store words: the message never carries the key or a request header.
export type SynthesisFailure = 'key' | 'permission' | 'quota' | 'voice' | 'busy' | 'http' | 'network' | 'timeout' | 'too-long';

export class SynthesisError extends Error {
  constructor(
    readonly kind: SynthesisFailure,
    readonly status?: number,
  ) {
    super(status ? `${kind} (HTTP ${status})` : kind);
  }
}

export interface TextToSpeech {
  // The whole text as one audio clip. `lang` is the reply's language (ISO 639-1).
  synthesize(text: string, request: { key: string; voiceId: string; lang: string }, signal: AbortSignal): Promise<Blob>;
}

export interface ListedVoice {
  id: string;
  name: string;
  // A few of its labels (accent, gender, age), for telling voices apart.
  description: string;
  previewUrl: string | null;
}

// The voices a key's account can use, and their free samples, for the picker in Settings.
export interface VoiceCatalog {
  listVoices(key: string, signal?: AbortSignal): Promise<ListedVoice[]>;
  preview(url: string, signal?: AbortSignal): Promise<Blob>;
}
