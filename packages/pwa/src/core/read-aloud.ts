import type { SpeechPort } from './ports/speech';
import { speakableChunks } from './speakable';

// A rough speaking rate: the voice says nothing of where it is, so positions are estimates.
export const CHARS_PER_SECOND = 15;

// How long a voice may take to start before the player says it is silent: a phone with no voice
// for the language, or a browser that refused, often fires nothing at all. Android's first
// utterance after a browser start waits on the speech engine's own start (measured: 4.2 s).
export const START_TIMEOUT_MS = 12_000;

export type ReadAloudState = 'idle' | 'playing' | 'paused' | 'ended';

// The speeds the player offers; 1 is the voice's own.
export const READ_ALOUD_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

// Plays a reply with the phone's voice, one utterance per chunk. It never uses the voice's own
// pause/resume (unreliable on iOS and Android): pausing cancels the queue and remembers the
// chunk, and playing queues again from it, so a pause or a skip restarts at a chunk's start.
export class ReadAloud {
  state: ReadAloudState = 'idle';
  index = 0;
  private chunks: string[] = [];
  private starts: number[] = [];
  // Bumped by every cancel: the voice may still fire `end` on what it dropped.
  private generation = 0;
  private lang = '';
  // Positions and skips are in seconds at this speed; `starts` stays at the voice's own.
  rate = 1;

  constructor(
    private readonly speech: SpeechPort,
    private readonly onChange: () => void = () => {},
    private readonly options: {
      // `no-start` when the voice stayed silent, else the browser's error code.
      onError?: (code: string) => void;
      startTimer?: (fn: () => void, ms: number) => () => void;
    } = {},
  ) {}
  private cancelWatch: (() => void) | null = null;

  get duration(): number {
    const last = this.chunks.length - 1;
    return last < 0 ? 0 : (this.starts[last]! + this.chunks[last]!.length / CHARS_PER_SECOND) / this.rate;
  }

  get position(): number {
    return (this.starts[this.index] ?? 0) / this.rate;
  }

  // A reading under way restarts its sentence at the new speed.
  setRate(rate: number): void {
    if (rate === this.rate) return;
    this.rate = rate;
    if (this.state === 'playing') this.play();
    else this.onChange();
  }

  // `lang` names the voice: the language the reply is written in.
  start(text: string, lang: string): void {
    this.lang = lang;
    this.chunks = speakableChunks(text);
    let at = 0;
    this.starts = this.chunks.map((chunk) => {
      const start = at;
      at += chunk.length / CHARS_PER_SECOND;
      return start;
    });
    this.index = 0;
    if (this.chunks.length === 0) return this.set('ended');
    this.play();
  }

  toggle(): void {
    if (this.state === 'playing') {
      this.silence();
      return this.set('paused');
    }
    if (this.state === 'ended') this.index = 0;
    if (this.chunks.length > 0) this.play();
  }

  skip(seconds: number): void {
    if (this.state !== 'playing' && this.state !== 'paused') return;
    const target = this.starts[this.index]! + seconds * this.rate;
    let next = this.starts.findLastIndex((start) => start <= target + 1e-9);
    if (seconds > 0) next = Math.max(next, this.index + 1);
    this.index = Math.min(Math.max(next, 0), this.chunks.length - 1);
    if (this.state === 'playing') this.play();
    else this.onChange();
  }

  stop(): void {
    this.silence();
    this.chunks = [];
    this.starts = [];
    this.index = 0;
    this.set('idle');
  }

  private play(): void {
    this.silence();
    const generation = this.generation;
    const last = this.chunks.length - 1;
    let started = false;
    this.cancelWatch = this.options.startTimer?.(() => {
      if (generation === this.generation && !started) this.fail('no-start');
    }, START_TIMEOUT_MS) ?? null;
    for (let i = this.index; i <= last; i++) {
      this.speech.speak(this.chunks[i]!, { lang: this.lang, rate: this.rate }, {
        start: () => {
          if (generation !== this.generation) return;
          started = true;
          this.index = i;
          this.onChange();
        },
        error: (code) => {
          if (generation === this.generation) this.fail(code);
        },
        end: () => {
          if (generation !== this.generation || i !== last) return;
          this.index = 0;
          this.set('ended');
        },
      });
    }
    this.set('playing');
  }

  private fail(code: string): void {
    this.silence();
    this.set('paused');
    this.options.onError?.(code);
  }

  private silence(): void {
    this.cancelWatch?.();
    this.cancelWatch = null;
    this.generation++;
    this.speech.cancel();
  }

  private set(state: ReadAloudState): void {
    this.state = state;
    this.onChange();
  }
}
