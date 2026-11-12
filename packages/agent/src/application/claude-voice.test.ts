import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANCEL_KEY, CANCEL_POLL_MS, CANCEL_WAIT_MS, ClaudeVoice, DRAIN_MS, HOLD_REPEAT_MS, IDLE_MS, LEAD_MS, MAX_MS, TAIL_MS, claudeVoiceListening, voiceSettingsProblem } from './claude-voice';

function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('voiceSettingsProblem', () => {
  it('accepts voice on in hold mode, the default mode', () => {
    expect(voiceSettingsProblem({ voice: { enabled: true, mode: 'hold' } })).toBeNull();
    expect(voiceSettingsProblem({ voiceEnabled: true })).toBeNull();
  });

  it('refuses voice turned off, never turned on, or settings it cannot read', () => {
    expect(voiceSettingsProblem({ voice: { enabled: false } })).toMatch(/\/voice/);
    expect(voiceSettingsProblem({ voiceEnabled: false })).toMatch(/\/voice/);
    expect(voiceSettingsProblem({ voice: { mode: 'hold' } })).toMatch(/\/voice/);
    expect(voiceSettingsProblem({})).toMatch(/\/voice/);
    expect(voiceSettingsProblem(null)).toMatch(/\/voice/);
  });

  it('refuses tap mode, where each held space would submit', () => {
    expect(voiceSettingsProblem({ voice: { enabled: true, mode: 'tap' } })).toMatch(/hold/);
  });
});

describe('ClaudeVoice', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(settings: unknown = { voice: { enabled: true, mode: 'hold' } }) {
    const playing = deferred();
    const written: number[] = [];
    const stream = { played: playing.promise, write: vi.fn((pcm: Uint8Array) => void written.push(...pcm)), end: vi.fn(() => playing.promise), abort: vi.fn() };
    const open = vi.fn(() => stream);
    const voice = new ClaudeVoice({ player: { open, available: async () => true }, settings: { read: async () => settings } });
    const presses: number[] = [];
    const press = () => void presses.push(Date.now());
    return { voice, open, stream, written, playing, presses, press };
  }
  const pcm = (...bytes: number[]) => new Uint8Array(bytes);

  it('is available where its player is', async () => {
    const settings = { read: async () => null };
    const open = vi.fn();
    expect(await new ClaudeVoice({ player: { open, available: async () => true }, settings }).available()).toBe(true);
    expect(await new ClaudeVoice({ player: { open, available: async () => false }, settings }).available()).toBe(false);
  });

  it('holds space at once and plays the audio LEAD_MS later, with what arrived meanwhile', async () => {
    const { voice, open, written, presses, press } = setup();
    const session = voice.start(press);
    await vi.advanceTimersByTimeAsync(0);
    expect(presses).toHaveLength(1);
    session.write(pcm(1));
    await vi.advanceTimersByTimeAsync(LEAD_MS - 1);
    expect(open).not.toHaveBeenCalled();
    expect(presses.length).toBeGreaterThan(LEAD_MS / HOLD_REPEAT_MS - 2);
    session.write(pcm(2));
    await vi.advanceTimersByTimeAsync(1);
    expect(written).toEqual([1, 2]);
    session.write(pcm(3));
    expect(written).toEqual([1, 2, 3]);
  });

  it('releases space TAIL_MS after the audio has played out', async () => {
    const { voice, stream, playing, presses, press } = setup();
    const session = voice.start(press);
    await vi.advanceTimersByTimeAsync(LEAD_MS + 2000);
    session.end();
    expect(stream.end).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(800);
    playing.resolve();
    await vi.advanceTimersByTimeAsync(TAIL_MS - HOLD_REPEAT_MS);
    const held = presses.length;
    await vi.advanceTimersByTimeAsync(HOLD_REPEAT_MS);
    await expect(session.done).resolves.toBeNull();
    const count = presses.length;
    expect(count).toBeGreaterThan(held - 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(presses.length).toBe(count);
  });

  it('plays and ends a dictation that ended before playback began', async () => {
    const { voice, stream, written, playing, press } = setup();
    const session = voice.start(press);
    session.write(pcm(7));
    session.end();
    await vi.advanceTimersByTimeAsync(LEAD_MS);
    expect(written).toEqual([7]);
    expect(stream.end).toHaveBeenCalledOnce();
    playing.resolve();
    await vi.advanceTimersByTimeAsync(TAIL_MS);
    await expect(session.done).resolves.toBeNull();
  });

  it('refuses a second dictation while one runs, and takes the next once it is done', async () => {
    const { voice, playing, press } = setup();
    const first = voice.start(press);
    await expect(voice.start(press).done).resolves.toMatch(/already in use/);
    first.end();
    await vi.advanceTimersByTimeAsync(LEAD_MS);
    playing.resolve();
    await vi.advanceTimersByTimeAsync(TAIL_MS);
    await expect(first.done).resolves.toBeNull();
    const next = voice.start(press);
    next.abort('done');
    await expect(next.done).resolves.toBe('done');
  });

  it('reports a failed playback and stops holding', async () => {
    const { voice, playing, presses, press } = setup();
    const session = voice.start(press);
    await vi.advanceTimersByTimeAsync(LEAD_MS);
    session.end();
    playing.reject(new Error('aplay: no loopback device'));
    await expect(session.done).resolves.toMatch(/no loopback device/);
    const count = presses.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(presses.length).toBe(count);
  });

  it('ends at once when the player dies mid-stream', async () => {
    const { voice, playing, presses, press } = setup();
    const session = voice.start(press);
    await vi.advanceTimersByTimeAsync(LEAD_MS + 500);
    playing.reject(new Error('aplay: no such device'));
    await expect(session.done).resolves.toMatch(/no such device/);
    const count = presses.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(presses.length).toBe(count);
  });

  it('stops a player that does not finish after the end', async () => {
    const { voice, stream, press } = setup();
    const session = voice.start(press);
    await vi.advanceTimersByTimeAsync(LEAD_MS);
    session.end();
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await expect(session.done).resolves.toMatch(/did not finish/);
    expect(stream.abort).toHaveBeenCalled();
  });

  it('gives up when the phone stops sending, and stops the player', async () => {
    const { voice, stream, presses, press } = setup();
    const session = voice.start(press);
    await vi.advanceTimersByTimeAsync(IDLE_MS - 100);
    session.write(pcm(1));
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    expect(stream.abort).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(session.done).resolves.toMatch(/stopped sending/);
    expect(stream.abort).toHaveBeenCalled();
    const count = presses.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(presses.length).toBe(count);
  });

  it('stops a dictation that runs past MAX_MS', async () => {
    const { voice, press } = setup();
    const session = voice.start(press);
    for (let t = 0; t < MAX_MS; t += 1000) {
      session.write(pcm(0));
      await vi.advanceTimersByTimeAsync(1000);
    }
    await expect(session.done).resolves.toMatch(/5 minutes/);
  });

  it('keeps going when a press throws', async () => {
    const { voice, playing } = setup();
    let presses = 0;
    const session = voice.start(() => {
      presses++;
      throw new Error('pty gone');
    });
    session.end();
    await vi.advanceTimersByTimeAsync(LEAD_MS);
    playing.resolve();
    await vi.advanceTimersByTimeAsync(TAIL_MS);
    await expect(session.done).resolves.toBeNull();
    expect(presses).toBeGreaterThan(1);
  });

  it('presses nothing and opens no player when the settings refuse', async () => {
    const { voice, open, presses, press } = setup({ voice: { enabled: true, mode: 'tap' } });
    const session = voice.start(press);
    await expect(session.done).resolves.toMatch(/hold/);
    await vi.advanceTimersByTimeAsync(LEAD_MS);
    expect(open).not.toHaveBeenCalled();
    expect(presses).toEqual([]);
    await expect(voice.start(press).done).resolves.toMatch(/hold/);
  });

  describe('cancel', () => {
    function pane(listening: () => boolean) {
      const keys: string[] = [];
      return { keys, pane: { listening: async () => listening(), pressCancel: () => void keys.push(CANCEL_KEY) } };
    }

    it('stops the player and the hold, then cancels Claude’s recording, once it listens', async () => {
      const { voice, stream, presses, press } = setup();
      const { keys, pane: p } = pane(() => true);
      const session = voice.start(press, p);
      await vi.advanceTimersByTimeAsync(LEAD_MS + 500);
      session.cancel();
      await vi.advanceTimersByTimeAsync(0);
      expect(stream.abort).toHaveBeenCalled();
      expect(keys).toEqual([CANCEL_KEY]);
      await expect(session.done).resolves.toBeNull();
      const count = presses.length;
      await vi.advanceTimersByTimeAsync(1000);
      expect(presses.length).toBe(count);
    });

    it('still cancels when the killed player reports its death', async () => {
      const { voice, stream, playing, press } = setup();
      stream.abort.mockImplementation(() => playing.reject(new Error('aplay: exited with SIGKILL')));
      let resolveListening!: (v: boolean) => void;
      const keys: string[] = [];
      const session = voice.start(press, { listening: () => new Promise((r) => (resolveListening = r)), pressCancel: () => void keys.push(CANCEL_KEY) });
      await vi.advanceTimersByTimeAsync(LEAD_MS + 500);
      session.cancel();
      await vi.advanceTimersByTimeAsync(0);
      resolveListening(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(keys).toEqual([CANCEL_KEY]);
      await expect(session.done).resolves.toBeNull();
    });

    it('ignores an end that arrives while cancelling', async () => {
      const { voice, stream, press } = setup();
      const { pane: p } = pane(() => false);
      const session = voice.start(press, p);
      await vi.advanceTimersByTimeAsync(LEAD_MS + 100);
      session.cancel();
      session.end();
      expect(stream.end).not.toHaveBeenCalled();
      session.abort('Superseded');
      await expect(session.done).resolves.toBe('Superseded');
    });

    it('keeps holding until Claude listens, so the key never reaches a prompt that is not recording', async () => {
      const { voice, open, presses, press } = setup();
      let listening = false;
      const { keys, pane: p } = pane(() => listening);
      const session = voice.start(press, p);
      await vi.advanceTimersByTimeAsync(HOLD_REPEAT_MS * 2);
      session.cancel();
      await vi.advanceTimersByTimeAsync(CANCEL_POLL_MS * 3);
      expect(keys).toEqual([]);
      const held = presses.length;
      await vi.advanceTimersByTimeAsync(HOLD_REPEAT_MS * 2);
      expect(presses.length).toBeGreaterThan(held);
      listening = true;
      await vi.advanceTimersByTimeAsync(CANCEL_POLL_MS);
      expect(keys).toEqual([CANCEL_KEY]);
      await expect(session.done).resolves.toBeNull();
      await vi.advanceTimersByTimeAsync(LEAD_MS);
      expect(open).not.toHaveBeenCalled();
    });

    it('releases with no key when Claude never shows it listens', async () => {
      const { voice, press } = setup();
      const { keys, pane: p } = pane(() => false);
      const session = voice.start(press, p);
      await vi.advanceTimersByTimeAsync(LEAD_MS);
      session.cancel();
      await vi.advanceTimersByTimeAsync(CANCEL_WAIT_MS);
      expect(keys).toEqual([]);
      await expect(session.done).resolves.toMatch(/not listening/);
    });

    it('presses nothing for a dictation cancelled before its hold began', async () => {
      const { voice, presses, press } = setup();
      const { keys, pane: p } = pane(() => true);
      const session = voice.start(press, p);
      session.cancel();
      await vi.advanceTimersByTimeAsync(LEAD_MS);
      expect(presses).toEqual([]);
      expect(keys).toEqual([]);
      await expect(session.done).resolves.toBeNull();
    });

    it('ignores a cancel after the end, and one with no pane to press', async () => {
      const { voice, playing, press } = setup();
      const { keys, pane: p } = pane(() => true);
      const session = voice.start(press, p);
      await vi.advanceTimersByTimeAsync(LEAD_MS);
      session.end();
      session.cancel();
      playing.resolve();
      await vi.advanceTimersByTimeAsync(TAIL_MS);
      await expect(session.done).resolves.toBeNull();
      expect(keys).toEqual([]);
      const bare = voice.start(press);
      await vi.advanceTimersByTimeAsync(LEAD_MS);
      bare.cancel();
      await vi.advanceTimersByTimeAsync(0);
      await expect(bare.done).resolves.toMatch(/not listening/);
    });
  });
});

describe('claudeVoiceListening', () => {
  const screen = (status: string) => ['● some reply', '', `${' '.repeat(90)}${status}`, '─'.repeat(40), '❯ hello', '─'.repeat(40), '  ⏵⏵ auto mode on'].join('\n');

  it('reads the indicator Claude Code 2.1 shows while it records', () => {
    expect(claudeVoiceListening(screen('listening…'))).toBe(true);
    expect(claudeVoiceListening(screen('Voice: processing…'))).toBe(false);
    expect(claudeVoiceListening(screen('◐ medium · /effort'))).toBe(false);
  });

  it('ignores the word in the conversation above the prompt', () => {
    const above = ['I am listening…', ...Array(10).fill('text'), screen('')].join('\n');
    expect(claudeVoiceListening(above)).toBe(false);
  });
});
