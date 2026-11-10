import type { AudioOutput } from './ports/audio-output';
import { SynthesisError, type SynthesisFailure, type TextToSpeech } from './ports/text-to-speech';
import type { ReadAloudState } from './read-aloud';
import { DEFAULT_ELEVENLABS_VOICE, ELEVENLABS_MAX_CHARS, type ElevenLabsVoice } from './read-aloud-voice';
import { speakableChunks } from './speakable';

export type AudioReadAloudFailure = SynthesisFailure | 'playback';

// Reads a reply with ElevenLabs: the whole speakable text in one request, played as one clip, so
// pause, seeking, speed and the clock are the element's own and exact. A failure can only come
// before playback starts, which is where the store falls back to the phone's voice; and nothing
// after the request needs the machine's key, which is dropped with the machine's connection.
export class AudioReadAloud {
  state: ReadAloudState = 'idle';
  rate = 1;
  duration = 0;
  // Bumped by every start and stop: a clip or an error from a superseded request is ignored.
  private generation = 0;
  private abort: AbortController | null = null;
  private cancelTick: (() => void) | null = null;

  constructor(
    private readonly tts: TextToSpeech,
    private readonly audio: AudioOutput,
    private readonly onChange: () => void = () => {},
    private readonly options: {
      onError?: (kind: AudioReadAloudFailure) => void;
      // The chosen voice is gone from the account: the reading goes on with the default.
      onVoiceGone?: () => void;
      tick?: (fn: () => void, ms: number) => () => void;
    } = {},
  ) {}

  get position(): number {
    return this.state === 'playing' || this.state === 'paused' || this.state === 'ended' ? Math.min(this.audio.time(), this.duration) : 0;
  }

  start(text: string, lang: string, request: { key: string; voice: ElevenLabsVoice }): void {
    this.reset();
    const speakable = speakableChunks(text).join('\n');
    if (!speakable) return this.set('ended');
    if (speakable.length > ELEVENLABS_MAX_CHARS) return this.fail('too-long');
    this.set('loading');
    void this.request(speakable, lang, request.key, request.voice.id, this.generation);
  }

  toggle(): void {
    if (this.state === 'playing') {
      this.audio.pause();
      return this.set('paused');
    }
    if (this.state === 'ended') this.audio.seek(0);
    if (this.state === 'paused' || this.state === 'ended') this.play();
  }

  skip(seconds: number): void {
    if (this.state !== 'playing' && this.state !== 'paused') return;
    this.audio.seek(Math.min(Math.max(this.audio.time() + seconds, 0), this.duration));
    this.onChange();
  }

  setRate(rate: number): void {
    this.rate = rate;
    this.audio.setRate(rate);
    this.onChange();
  }

  stop(): void {
    this.reset();
    this.set('idle');
  }

  private async request(text: string, lang: string, key: string, voiceId: string, generation: number): Promise<void> {
    const abort = new AbortController();
    this.abort = abort;
    let clip: Blob;
    try {
      clip = await this.tts.synthesize(text, { key, voiceId, lang }, abort.signal);
    } catch (e) {
      if (generation !== this.generation) return;
      const kind = e instanceof SynthesisError ? e.kind : 'network';
      if (kind === 'voice' && voiceId !== DEFAULT_ELEVENLABS_VOICE.id) {
        this.options.onVoiceGone?.();
        return this.request(text, lang, key, DEFAULT_ELEVENLABS_VOICE.id, generation);
      }
      return this.fail(kind);
    }
    if (generation !== this.generation) return;
    this.abort = null;
    this.audio.load(clip, {
      ready: (duration) => {
        if (generation !== this.generation) return;
        this.duration = duration;
        // An element resets its speed when it loads a clip.
        this.audio.setRate(this.rate);
        this.play();
      },
      end: () => {
        if (generation !== this.generation) return;
        this.set('ended');
      },
      error: () => {
        if (generation === this.generation) this.fail('playback');
      },
    });
  }

  private play(): void {
    this.audio.play();
    this.cancelTick?.();
    this.cancelTick = this.options.tick?.(() => this.onChange(), 500) ?? null;
    this.set('playing');
  }

  private fail(kind: AudioReadAloudFailure): void {
    this.reset();
    this.set('idle');
    this.options.onError?.(kind);
  }

  private reset(): void {
    this.generation++;
    this.abort?.abort();
    this.abort = null;
    this.audio.clear();
    this.duration = 0;
  }

  private set(state: ReadAloudState): void {
    if (state !== 'playing') {
      this.cancelTick?.();
      this.cancelTick = null;
    }
    this.state = state;
    this.onChange();
  }
}
