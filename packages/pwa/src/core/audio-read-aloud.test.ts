import { describe, it, expect, beforeEach } from 'vitest';
import { AudioReadAloud } from './audio-read-aloud';
import type { AudioOutput } from './ports/audio-output';
import { SynthesisError, type TextToSpeech } from './ports/text-to-speech';
import { DEFAULT_ELEVENLABS_VOICE, ELEVENLABS_MAX_CHARS } from './read-aloud-voice';

type Request = { text: string; voiceId: string; lang: string; signal: AbortSignal; resolve: (b: Blob) => void; reject: (e: unknown) => void };

class FakeTts implements TextToSpeech {
  requests: Request[] = [];
  synthesize(text: string, r: { key: string; voiceId: string; lang: string }, signal: AbortSignal): Promise<Blob> {
    return new Promise((resolve, reject) => this.requests.push({ text, voiceId: r.voiceId, lang: r.lang, signal, resolve, reject }));
  }
}

class FakeAudio implements AudioOutput {
  clip: Blob | null = null;
  events: { ready: (d: number) => void; end: () => void; error: () => void } | null = null;
  playing = false;
  at = 0;
  rate = 1;
  unlocked = 0;
  load(clip: Blob, events: FakeAudio['events'] & object) {
    this.clip = clip;
    this.events = events;
    this.at = 0;
    this.rate = 1;
  }
  play() {
    this.playing = true;
  }
  pause() {
    this.playing = false;
  }
  seek(s: number) {
    this.at = s;
  }
  time() {
    return this.at;
  }
  setRate(r: number) {
    this.rate = r;
  }
  clear() {
    this.clip = null;
    this.events = null;
    this.playing = false;
  }
  unlock() {
    this.unlocked++;
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const request = { key: 'k', voice: { id: 'v1', name: 'Ann' } };

let tts: FakeTts;
let audio: FakeAudio;
let errors: string[];
let voiceGone: number;
let player: AudioReadAloud;

beforeEach(() => {
  tts = new FakeTts();
  audio = new FakeAudio();
  errors = [];
  voiceGone = 0;
  player = new AudioReadAloud(tts, audio, () => {}, {
    onError: (kind) => errors.push(kind),
    onVoiceGone: () => voiceGone++,
  });
});

async function loaded(duration = 60) {
  tts.requests.at(-1)!.resolve(new Blob(['mp3']));
  await flush();
  audio.events!.ready(duration);
}

describe('AudioReadAloud', () => {
  it('synthesises the speakable text in one request and plays it', async () => {
    player.start('# Title\n\nThe build is **green**. Two tests.\n```\ncode\n```', 'fr', request);
    expect(player.state).toBe('loading');
    expect(tts.requests).toHaveLength(1);
    expect(tts.requests[0]).toMatchObject({ text: 'Title\nThe build is green.\nTwo tests.\ncode', voiceId: 'v1', lang: 'fr' });
    await loaded(42);
    expect(player.state).toBe('playing');
    expect(player.duration).toBe(42);
    expect(audio.playing).toBe(true);
  });

  it('applies the speed after the clip loads', async () => {
    player.setRate(1.5);
    player.start('Hello there.', 'en', request);
    await loaded();
    expect(audio.rate).toBe(1.5);
    player.setRate(2);
    expect(audio.rate).toBe(2);
    expect(player.position).toBe(0);
  });

  it('pauses, resumes and replays from the start once ended', async () => {
    player.start('Hello there.', 'en', request);
    await loaded();
    player.toggle();
    expect(player.state).toBe('paused');
    expect(audio.playing).toBe(false);
    player.toggle();
    expect(player.state).toBe('playing');
    audio.at = 60;
    audio.events!.end();
    expect(player.state).toBe('ended');
    player.toggle();
    expect(audio.at).toBe(0);
    expect(player.state).toBe('playing');
  });

  it('skips within the clip, clamped to its ends', async () => {
    player.start('Hello there.', 'en', request);
    await loaded(30);
    audio.at = 5;
    player.skip(10);
    expect(audio.at).toBe(15);
    player.skip(-20);
    expect(audio.at).toBe(0);
    player.skip(100);
    expect(audio.at).toBe(30);
  });

  it('ignores a clip that arrives after a stop, and aborts the request', async () => {
    player.start('Hello there.', 'en', request);
    const first = tts.requests[0]!;
    player.stop();
    expect(first.signal.aborted).toBe(true);
    first.resolve(new Blob(['late']));
    await flush();
    expect(audio.clip).toBeNull();
    expect(player.state).toBe('idle');
  });

  it('a new reading supersedes one still loading', async () => {
    player.start('First one.', 'en', request);
    player.start('Second one.', 'en', request);
    tts.requests[0]!.resolve(new Blob(['first']));
    await flush();
    expect(audio.clip).toBeNull();
    await loaded();
    expect(player.state).toBe('playing');
  });

  it('reports a failed request and goes idle', async () => {
    player.start('Hello there.', 'en', request);
    tts.requests[0]!.reject(new SynthesisError('quota', 401));
    await flush();
    expect(errors).toEqual(['quota']);
    expect(player.state).toBe('idle');
  });

  it('reports an unexpected failure as a network one', async () => {
    player.start('Hello there.', 'en', request);
    tts.requests[0]!.reject(new TypeError('Load failed'));
    await flush();
    expect(errors).toEqual(['network']);
  });

  it('reports a clip the element cannot play', async () => {
    player.start('Hello there.', 'en', request);
    tts.requests[0]!.resolve(new Blob(['x']));
    await flush();
    audio.events!.error();
    expect(errors).toEqual(['playback']);
    expect(player.state).toBe('idle');
  });

  it('retries with the default voice when the chosen one is gone', async () => {
    player.start('Hello there.', 'en', request);
    tts.requests[0]!.reject(new SynthesisError('voice', 404));
    await flush();
    expect(tts.requests).toHaveLength(2);
    expect(tts.requests[1]!.voiceId).toBe(DEFAULT_ELEVENLABS_VOICE.id);
    expect(voiceGone).toBe(1);
    expect(errors).toEqual([]);
  });

  it('does not retry the default voice itself', async () => {
    player.start('Hello there.', 'en', { key: 'k', voice: DEFAULT_ELEVENLABS_VOICE });
    tts.requests[0]!.reject(new SynthesisError('voice', 404));
    await flush();
    expect(tts.requests).toHaveLength(1);
    expect(errors).toEqual(['voice']);
  });

  it('refuses a reply over the cap without a request', () => {
    player.start('word '.repeat(ELEVENLABS_MAX_CHARS / 4) + '.', 'en', request);
    expect(tts.requests).toHaveLength(0);
    expect(errors).toEqual(['too-long']);
    expect(player.state).toBe('idle');
  });

  it('ends at once on a reply with nothing to say', () => {
    player.start('```\n```', 'en', request);
    expect(tts.requests).toHaveLength(0);
    expect(player.state).toBe('ended');
  });
});
