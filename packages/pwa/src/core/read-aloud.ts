import type { SpeechPort } from './ports/speech';
import { speakableChunks } from './speakable';

// A rough speaking rate: the voice says nothing of where it is, so positions are estimates.
export const CHARS_PER_SECOND = 15;

export type ReadAloudState = 'idle' | 'playing' | 'paused' | 'ended';

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

  constructor(
    private readonly speech: SpeechPort,
    private readonly onChange: () => void = () => {},
  ) {}

  get duration(): number {
    const last = this.chunks.length - 1;
    return last < 0 ? 0 : this.starts[last]! + this.chunks[last]!.length / CHARS_PER_SECOND;
  }

  get position(): number {
    return this.starts[this.index] ?? 0;
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
    const target = this.position + seconds;
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
    for (let i = this.index; i <= last; i++) {
      this.speech.speak(this.chunks[i]!, this.lang, {
        start: () => {
          if (generation !== this.generation) return;
          this.index = i;
          this.onChange();
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

  private silence(): void {
    this.generation++;
    this.speech.cancel();
  }

  private set(state: ReadAloudState): void {
    this.state = state;
    this.onChange();
  }
}
