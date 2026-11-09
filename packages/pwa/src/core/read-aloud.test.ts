import { describe, it, expect, beforeEach } from 'vitest';
import { ReadAloud, CHARS_PER_SECOND } from './read-aloud';
import type { SpeechPort } from './ports/speech';

type Queued = { text: string; start: () => void; end: () => void; error: (code: string) => void };

class FakeSpeech implements SpeechPort {
  queue: Queued[] = [];
  spoken: string[] = [];
  rates: number[] = [];
  speak(text: string, voice: { lang: string; rate: number }, events: { start: () => void; end: () => void; error: (code: string) => void }) {
    this.rates.push(voice.rate);
    this.queue.push({ text, ...events });
  }
  unlock() {}
  cancel() {
    const dropped = this.queue;
    this.queue = [];
    dropped.forEach((u) => u.end());
  }
  // The voice starts the head of its queue, then finishes it.
  startNext() {
    this.queue[0]!.start();
  }
  finishNext() {
    const u = this.queue.shift()!;
    this.spoken.push(u.text);
    u.end();
  }
  playNext() {
    this.startNext();
    this.finishNext();
  }
}

// Each sentence lasts exactly 5 s at the player's estimate.
const sentence = (n: number) => `S${n}`.padEnd(CHARS_PER_SECOND * 5 - 1, 'x') + '.';
const text = Array.from({ length: 6 }, (_, i) => sentence(i)).join(' ');

let speech: FakeSpeech;
let player: ReadAloud;

beforeEach(() => {
  speech = new FakeSpeech();
  player = new ReadAloud(speech);
});

describe('ReadAloud', () => {
  it('queues every sentence and plays to the end', () => {
    player.start(text, 'en');
    expect(player.state).toBe('playing');
    expect(speech.queue).toHaveLength(6);
    for (let i = 0; i < 6; i++) speech.playNext();
    expect(speech.spoken).toHaveLength(6);
    expect(player.state).toBe('ended');
    expect(player.index).toBe(0);
  });

  it('pauses, then resumes at the start of the sentence it was in', () => {
    player.start(text, 'en');
    speech.playNext();
    speech.startNext();
    player.toggle();
    expect(player.state).toBe('paused');
    expect(speech.queue).toHaveLength(0);
    player.toggle();
    expect(player.state).toBe('playing');
    expect(speech.queue[0]!.text).toBe(sentence(1));
  });

  it('a cancelled queue does not move or end the player', () => {
    player.start(text, 'en');
    speech.playNext();
    speech.startNext();
    player.toggle();
    expect(player.index).toBe(1);
    expect(player.state).toBe('paused');
  });

  it('skips forward and back by about ten seconds', () => {
    player.start(text, 'en');
    speech.playNext();
    speech.startNext(); // at 5 s
    player.skip(10);
    expect(player.index).toBe(3);
    expect(speech.queue[0]!.text).toBe(sentence(3));
    speech.startNext();
    player.skip(-10);
    expect(player.index).toBe(1);
    expect(player.state).toBe('playing');
  });

  it('stays inside the reply when skipping past either end', () => {
    player.start(text, 'en');
    speech.startNext();
    player.skip(-10);
    expect(player.index).toBe(0);
    player.skip(1000);
    expect(player.index).toBe(5);
  });

  it('skipping while paused moves without playing', () => {
    player.start(text, 'en');
    speech.startNext();
    player.toggle();
    player.skip(10);
    expect(player.index).toBe(2);
    expect(player.state).toBe('paused');
    expect(speech.queue).toHaveLength(0);
  });

  it('plays again from the start once ended', () => {
    player.start('One. Two.', 'en');
    speech.playNext();
    speech.playNext();
    player.toggle();
    expect(player.state).toBe('playing');
    expect(speech.queue.map((u) => u.text)).toEqual(['One.', 'Two.']);
  });

  it('reports where it is and how long the reply lasts', () => {
    player.start(text, 'en');
    speech.playNext();
    speech.startNext();
    expect(player.position).toBe(5);
    expect(player.duration).toBe(30);
  });

  it('stops for good', () => {
    player.start(text, 'en');
    speech.startNext();
    player.stop();
    expect(player.state).toBe('idle');
    expect(speech.queue).toHaveLength(0);
  });

  it('has nothing to play for a reply with no words', () => {
    player.start('```\n```', 'en');
    expect(player.state).toBe('ended');
    expect(speech.queue).toHaveLength(0);
  });

  it('tells its listener about every change', () => {
    let changes = 0;
    const p = new ReadAloud(speech, () => changes++);
    p.start('One. Two.', 'en');
    speech.startNext();
    expect(changes).toBeGreaterThanOrEqual(2);
  });

  it('stops and says why when the voice fails', () => {
    const errors: string[] = [];
    const p = new ReadAloud(speech, () => undefined, { onError: (code) => errors.push(code) });
    p.start(text, 'en');
    speech.queue[0]!.error('synthesis-failed');
    expect(errors).toEqual(['synthesis-failed']);
    expect(p.state).toBe('paused');
    expect(speech.queue).toHaveLength(0);
  });

  it('says so when the voice never starts', () => {
    const errors: string[] = [];
    const timers: Array<() => void> = [];
    const p = new ReadAloud(speech, () => undefined, { onError: (code) => errors.push(code), startTimer: (fn) => (timers.push(fn), () => undefined) });
    p.start(text, 'en');
    timers.at(-1)!();
    expect(errors).toEqual(['no-start']);
    expect(p.state).toBe('paused');
  });

  it('does not complain about a voice that started', () => {
    const errors: string[] = [];
    const timers: Array<() => void> = [];
    const p = new ReadAloud(speech, () => undefined, { onError: (code) => errors.push(code), startTimer: (fn) => (timers.push(fn), () => undefined) });
    p.start(text, 'en');
    speech.startNext();
    timers.at(-1)!();
    expect(errors).toEqual([]);
    expect(p.state).toBe('playing');
  });

  it('restarts the sentence under way at a new speed, and keeps its clock reading', () => {
    player.start(text, 'en');
    speech.playNext();
    speech.startNext();
    expect(player.position).toBe(5);
    player.setRate(2);
    expect(player.state).toBe('playing');
    expect(speech.queue[0]!.text).toBe(sentence(1));
    expect(speech.rates.at(-1)).toBe(2);
    expect(player.position).toBe(5);
    expect(player.duration).toBe(30);
  });

  it('skips ten seconds of the reply whatever the speed', () => {
    player.setRate(2);
    player.start(text, 'en');
    speech.startNext();
    player.skip(10);
    expect(player.index).toBe(2);
  });

  describe('its clock', () => {
    let now: number;
    let ticks: Array<() => void>;
    let cancelled: number;
    let changes: number;
    let p: ReadAloud;
    beforeEach(() => {
      now = 0;
      ticks = [];
      cancelled = 0;
      changes = 0;
      p = new ReadAloud(speech, () => changes++, {
        now: () => now,
        tick: (fn) => (ticks.push(fn), () => cancelled++),
      });
    });

    it('moves every second inside a sentence, at the chosen speed', () => {
      p.start(text, 'en');
      speech.startNext();
      now = 2000;
      expect(p.position).toBe(2);
      p.setRate(1.5);
      speech.startNext();
      now = 4000;
      expect(p.position).toBe(3);
    });

    it('waits at the end of a sentence the voice reads slower than estimated', () => {
      p.start(text, 'en');
      speech.startNext();
      now = 9000;
      expect(p.position).toBe(5);
    });

    it('asks for a redraw every second while it plays, and stops asking once it does not', () => {
      p.start(text, 'en');
      expect(ticks).toHaveLength(1);
      const before = changes;
      ticks[0]!();
      expect(changes).toBe(before + 1);
      p.toggle();
      expect(cancelled).toBe(1);
      p.toggle();
      p.stop();
      expect(cancelled).toBe(2);
    });

    it('keeps one redraw going across a speed change', () => {
      p.start(text, 'en');
      p.setRate(2);
      expect(ticks).toHaveLength(2);
      expect(cancelled).toBe(1);
    });

    it('stops asking once the reply ends', () => {
      p.start('One.', 'en');
      speech.playNext();
      expect(p.state).toBe('ended');
      expect(cancelled).toBe(1);
    });

    it('shows a pause at the start of the sentence it will resume from', () => {
      p.start(text, 'en');
      speech.playNext();
      speech.startNext();
      now = 3000;
      p.toggle();
      expect(p.position).toBe(5);
    });
  });

  it('keeps a pause paused when the speed changes', () => {
    player.start(text, 'en');
    speech.startNext();
    player.toggle();
    player.setRate(1.5);
    expect(player.state).toBe('paused');
    expect(speech.queue).toHaveLength(0);
    player.toggle();
    expect(speech.rates.at(-1)).toBe(1.5);
  });
});
