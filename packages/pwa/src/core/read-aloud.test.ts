import { describe, it, expect, beforeEach } from 'vitest';
import { ReadAloud, CHARS_PER_SECOND } from './read-aloud';
import type { SpeechPort } from './ports/speech';

type Queued = { text: string; start: () => void; end: () => void };

class FakeSpeech implements SpeechPort {
  queue: Queued[] = [];
  spoken: string[] = [];
  speak(text: string, _lang: string, events: { start: () => void; end: () => void }) {
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
});
