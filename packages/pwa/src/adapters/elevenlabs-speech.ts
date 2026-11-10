import { SynthesisError, type ListedVoice, type TextToSpeech, type VoiceCatalog } from '../core/ports/text-to-speech';
import { elevenLabsFailure } from './elevenlabs-errors';

const API = 'https://api.elevenlabs.io';
// Flash v2.5: half the credits of Multilingual v2, and it takes `language_code`, which
// Multilingual v2 ignores, so the voice follows the reply's language.
export const TTS_MODEL_ID = 'eleven_flash_v2_5';
export const TTS_OUTPUT_FORMAT = 'mp3_44100_128';

// Measured with Flash v2.5: 500 characters answer in 1.9 s, 3,000 in 3.7 s.
const timeoutFor = (chars: number) => 15_000 + chars;

export class ElevenLabsSpeech implements TextToSpeech, VoiceCatalog {
  constructor(private readonly fetchFn: typeof fetch = (...args) => fetch(...args)) {}

  async synthesize(text: string, { key, voiceId, lang }: { key: string; voiceId: string; lang: string }, signal: AbortSignal): Promise<Blob> {
    const res = await this.call(
      `${API}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${TTS_OUTPUT_FORMAT}`,
      {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: TTS_MODEL_ID, language_code: lang }),
      },
      signal,
      timeoutFor(text.length),
    );
    // The bytes are MP3 whatever the response says: a blob: URL plays as the type it is given.
    return new Blob([await res.arrayBuffer()], { type: 'audio/mpeg' });
  }

  // The voices this key's account can use (its own and the premade ones). Listing costs no credit.
  async listVoices(key: string, signal?: AbortSignal): Promise<ListedVoice[]> {
    const voices: ListedVoice[] = [];
    let token: string | null = null;
    for (let page = 0; page < 10; page++) {
      const url = new URL(`${API}/v2/voices`);
      url.searchParams.set('page_size', '100');
      if (token) url.searchParams.set('next_page_token', token);
      const res = await this.call(url.toString(), { headers: { 'xi-api-key': key } }, signal, 15_000);
      const body = (await res.json()) as { voices?: unknown; has_more?: unknown; next_page_token?: unknown };
      for (const v of Array.isArray(body.voices) ? body.voices : []) {
        const voice = listedVoice(v);
        if (voice) voices.push(voice);
      }
      token = body.has_more === true && typeof body.next_page_token === 'string' ? body.next_page_token : null;
      if (!token) break;
    }
    return voices;
  }

  // A voice's sample, hosted by ElevenLabs and free to play. Fetched rather than played from its
  // URL, so the CSP's media-src stays the app's own and blob:.
  async preview(url: string, signal?: AbortSignal): Promise<Blob> {
    if (!url.startsWith('https://')) throw new SynthesisError('http');
    const res = await this.call(url, {}, signal, 15_000);
    return new Blob([await res.arrayBuffer()], { type: 'audio/mpeg' });
  }

  private async call(url: string, init: RequestInit, outer: AbortSignal | undefined, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const forward = () => controller.abort();
    outer?.addEventListener('abort', forward);
    let res: Response;
    try {
      res = await this.fetchFn(url, { ...init, signal: controller.signal });
    } catch {
      throw new SynthesisError(controller.signal.aborted && !outer?.aborted ? 'timeout' : 'network');
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', forward);
    }
    if (!res.ok) throw new SynthesisError(await elevenLabsFailure(res), res.status);
    return res;
  }
}

function listedVoice(v: unknown): ListedVoice | null {
  const voice = v as { voice_id?: unknown; name?: unknown; labels?: Record<string, unknown>; preview_url?: unknown };
  if (typeof voice?.voice_id !== 'string' || typeof voice.name !== 'string') return null;
  const labels = voice.labels ?? {};
  const description = ['accent', 'gender', 'age']
    .map((k) => labels[k])
    .filter((l): l is string => typeof l === 'string' && l !== '')
    .map((l) => l.replace(/_/g, ' '))
    .join(', ');
  const previewUrl = typeof voice.preview_url === 'string' && voice.preview_url.startsWith('https://') ? voice.preview_url : null;
  return { id: voice.voice_id, name: voice.name, description, previewUrl };
}
