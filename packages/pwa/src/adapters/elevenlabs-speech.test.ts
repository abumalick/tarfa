import { describe, it, expect, vi } from 'vitest';
import { ElevenLabsSpeech, TTS_MODEL_ID } from './elevenlabs-speech';
import { SynthesisError } from '../core/ports/text-to-speech';

const audioResponse = () => ({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2]).buffer) }) as unknown as Response;
const errorResponse = (status: number, detail?: unknown) =>
  ({ ok: false, status, json: () => (detail ? Promise.resolve({ detail }) : Promise.reject(new Error('no body'))) }) as unknown as Response;
const jsonResponse = (body: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as unknown as Response;
const signal = () => new AbortController().signal;

async function failure(promise: Promise<unknown>) {
  const e = await promise.then(() => null, (err: unknown) => err);
  expect(e).toBeInstanceOf(SynthesisError);
  return e as SynthesisError;
}

describe('ElevenLabsSpeech.synthesize', () => {
  it('posts the text with the voice, model and language, and returns an MP3 blob', async () => {
    const fetchFn = vi.fn().mockResolvedValue(audioResponse());
    const clip = await new ElevenLabsSpeech(fetchFn).synthesize('Hello.', { key: 'sk_test', voiceId: 'v 1', lang: 'fr' }, signal());
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/v%201?output_format=mp3_44100_128');
    expect(init.method).toBe('POST');
    expect(init.headers['xi-api-key']).toBe('sk_test');
    expect(JSON.parse(init.body)).toEqual({ text: 'Hello.', model_id: TTS_MODEL_ID, language_code: 'fr' });
    expect(clip.type).toBe('audio/mpeg');
    expect(clip.size).toBe(2);
  });

  it.each([
    [401, { status: 'quota_exceeded' }, 'quota'],
    [402, undefined, 'quota'],
    [401, { status: 'missing_permissions' }, 'permission'],
    [401, { status: 'invalid_api_key' }, 'key'],
    [404, { status: 'voice_not_found' }, 'voice'],
    [429, { status: 'too_many_concurrent_requests' }, 'busy'],
    [500, undefined, 'http'],
  ])('maps HTTP %i %j to %s', async (status, detail, kind) => {
    const fetchFn = vi.fn().mockResolvedValue(errorResponse(status, detail));
    const e = await failure(new ElevenLabsSpeech(fetchFn).synthesize('Hi.', { key: 'sk_secret', voiceId: 'v', lang: 'en' }, signal()));
    expect(e.kind).toBe(kind);
    expect(e.message).not.toContain('sk_secret');
  });

  it('reports a network failure', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Load failed'));
    expect((await failure(new ElevenLabsSpeech(fetchFn).synthesize('Hi.', { key: 'k', voiceId: 'v', lang: 'en' }, signal()))).kind).toBe('network');
  });

  it('times out a request that hangs', async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('aborted')))));
      const pending = failure(new ElevenLabsSpeech(fetchFn).synthesize('Hi.', { key: 'k', voiceId: 'v', lang: 'en' }, signal()));
      await vi.advanceTimersByTimeAsync(20_000);
      expect((await pending).kind).toBe('timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts the request with the caller', async () => {
    const outer = new AbortController();
    let seen: AbortSignal | undefined;
    const fetchFn = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      seen = init!.signal!;
      return new Promise<Response>(() => {});
    });
    void new ElevenLabsSpeech(fetchFn).synthesize('Hi.', { key: 'k', voiceId: 'v', lang: 'en' }, outer.signal).catch(() => {});
    outer.abort();
    expect(seen!.aborted).toBe(true);
  });
});

describe('ElevenLabsSpeech.listVoices', () => {
  it('lists every page with names, labels and previews', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          voices: [
            { voice_id: 'a', name: 'Ann', labels: { accent: 'british', gender: 'female', age: 'middle_aged' }, preview_url: 'https://x.test/a.mp3' },
            { voice_id: 3, name: 'broken' },
          ],
          has_more: true,
          next_page_token: 'p2',
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ voices: [{ voice_id: 'b', name: 'Bo', preview_url: 'http://insecure.test' }], has_more: false }));
    const voices = await new ElevenLabsSpeech(fetchFn).listVoices('sk_test');
    expect(voices).toEqual([
      { id: 'a', name: 'Ann', description: 'british, female, middle aged', previewUrl: 'https://x.test/a.mp3' },
      { id: 'b', name: 'Bo', description: '', previewUrl: null },
    ]);
    expect(fetchFn.mock.calls[0]![1].headers['xi-api-key']).toBe('sk_test');
    expect(String(fetchFn.mock.calls[1]![0])).toContain('next_page_token=p2');
  });

  it('reports a key that may not list voices', async () => {
    const fetchFn = vi.fn().mockResolvedValue(errorResponse(401, { status: 'missing_permissions' }));
    expect((await failure(new ElevenLabsSpeech(fetchFn).listVoices('k'))).kind).toBe('permission');
  });
});

describe('ElevenLabsSpeech.preview', () => {
  it('fetches the sample without the key, as MP3', async () => {
    const fetchFn = vi.fn().mockResolvedValue(audioResponse());
    const clip = await new ElevenLabsSpeech(fetchFn).preview('https://x.test/a.mp3');
    expect(fetchFn.mock.calls[0]![1].headers).toBeUndefined();
    expect(clip.type).toBe('audio/mpeg');
  });

  it('refuses a sample that is not https', async () => {
    const fetchFn = vi.fn();
    await failure(new ElevenLabsSpeech(fetchFn).preview('javascript:alert(1)'));
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
