import type { ScribeModel } from '../core/dictation-presets';
import type { Transcriber } from '../core/ports/transcriber';
import { msg } from '../i18n.svelte';
import { elevenLabsFailure } from './elevenlabs-errors';

export const SCRIBE_ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text';

// Transcribes audio via ElevenLabs Scribe directly from the browser. The API key and the
// keyterm vocabulary are read lazily on each call (so a key entered after construction, or a
// vocabulary that arrives with a later reconnect, is picked up), and so are the model and
// languages of the preset the dictation started with. With no language set, Scribe
// auto-detects. The request is bounded by a timeout so a hung network call surfaces as an error the UI can leave and retry, rather than leaving dictation stuck "transcribing"
// forever.
export class ElevenLabsTranscriber implements Transcriber {
  constructor(
    private readonly getKey: () => string | null,
    private readonly getKeyterms: () => string[] = () => [],
    private readonly getScribe: () => { model: ScribeModel; languages: string[] } = () => ({ model: 'scribe_v2', languages: [] }),
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    private readonly timeoutMs = 30_000,
  ) {}

  async transcribe(audio: Blob): Promise<string> {
    const key = this.getKey();
    if (!key) throw new Error(msg().dictation.setKey('ElevenLabs'));

    const form = new FormData();
    form.append('file', audio, audioFileName(audio.type));
    const { model, languages } = this.getScribe();
    form.append('model_id', model);
    // Drop filler words, false starts and non-speech sounds at the source.
    form.append('no_verbatim', 'true');
    // scribe_v2 refuses these with a 400. Secondary codes need a main one (alone they fail with
    // a 500), and the main one steers the whole transcript, so the first listed is the main one.
    // No `numbers_format`: on v3 any value makes the API ignore `no_verbatim` (the fillers come
    // back), and v3 writes numbers as digits without it.
    if (model === 'scribe_v3') {
      const [main, ...others] = languages;
      if (main) form.append('language_code', main);
      for (const code of others) form.append('secondary_language_codes', code);
    }
    // Defaults to true server-side, which types "(baby crying)" into the terminal.
    form.append('tag_audio_events', 'false');
    // One part per term is how the API takes a list; the agent already validated and capped
    // them, so they go on the wire as they arrive.
    for (const term of this.getKeyterms()) form.append('keyterms', term);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchFn(SCRIBE_ENDPOINT, {
        method: 'POST',
        headers: { 'xi-api-key': key },
        body: form,
        signal: controller.signal,
      });
    } catch (e) {
      if (controller.signal.aborted) throw new Error(msg().dictation.timedOut);
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(await errorMessage(res));

    const data: unknown = await res.json();
    const text = (data as { text?: unknown })?.text;
    return typeof text === 'string' ? text : '';
  }
}

// Name the upload after what the platform actually recorded (Safari → mp4, Chromium → webm),
// so the extension never contradicts the bytes.
function audioFileName(mimeType: string): string {
  const type = mimeType.split(';')[0]?.trim().toLowerCase();
  if (type === 'audio/mp4' || type === 'audio/aac') return 'audio.m4a';
  if (type === 'audio/ogg') return 'audio.ogg';
  if (type === 'audio/mpeg') return 'audio.mp3';
  if (type === 'audio/wav' || type === 'audio/x-wav') return 'audio.wav';
  return 'audio.webm';
}

async function errorMessage(res: Response): Promise<string> {
  const failure = await elevenLabsFailure(res);
  if (failure === 'quota') return msg().dictation.elevenLabsQuota;
  if (failure === 'key' || failure === 'permission') return msg().dictation.invalidKey('ElevenLabs');
  return msg().dictation.transcriptionFailedHttp(res.status);
}
