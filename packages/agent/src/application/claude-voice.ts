import type { ClaudeSettingsPort, VoicePlayerPort, VoiceStream } from '../ports/voice-stream-port';

// A terminal reports no key release, so Claude Code reads a held space from the stream of
// repeats a held key produces; this is that stream. Claude needs about a second of hold
// before it records (it warms up), so playback starts LEAD_MS late with the audio that
// arrived meanwhile, and a little after the audio before the release counts.
export const HOLD_REPEAT_MS = 30;
export const LEAD_MS = 1000;
export const TAIL_MS = 500;
// The hold must end even when the phone vanishes mid-sentence.
export const IDLE_MS = 5000;
export const MAX_MS = 5 * 60_000;
// After the end, what is left to play is about LEAD_MS of lag; a player still going well past
// that is stuck.
export const DRAIN_MS = LEAD_MS + 10_000;
// A cancel waits for Claude to show it records, polling the pane, holding space meanwhile.
export const CANCEL_POLL_MS = 50;
export const CANCEL_WAIT_MS = 1500;
// Ctrl+C, not Esc: Claude Code treats both as "discard the recording" while it listens, but an
// Esc written through the attached tmux client never cancelled (measured on 2.1.322), while
// Ctrl+C did every time. Outside a recording the same key clears the prompt or interrupts the
// turn, hence the wait for the indicator.
const NOT_LISTENING = 'Dictation not cancelled: Claude was not listening';
export const CANCEL_KEY = '\x03';

// Whether the pane shows Claude Code recording a held-space dictation: `listening…` alone on the
// line just above the prompt box (measured on 2.1.322, from ~145 ms into the hold). A future
// Claude that words it otherwise turns a cancel into a release, never a stray key.
export function claudeVoiceListening(screen: string): boolean {
  const lines = screen.split('\n');
  let prompt = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.startsWith('❯')) {
      prompt = i;
      break;
    }
  }
  return prompt >= 2 && lines[prompt - 2]!.trim() === 'listening…';
}

// The workspace a dictation types into, for a cancel: whether Claude records, and the key that
// makes it throw the recording away.
export interface VoicePane {
  listening(): Promise<boolean>;
  pressCancel(): void;
}

// Why the held spaces would not be read as voice, or null. In tap mode every space toggles
// recording and submits the prompt, and with voice off they would be typed: both would spray
// the conversation. Voice is off until /voice turns it on, so only an explicit `true` counts;
// a missing mode is Claude's default, hold.
export function voiceSettingsProblem(settings: unknown): string | null {
  const s = (typeof settings === 'object' && settings !== null ? settings : {}) as {
    voiceEnabled?: unknown;
    voice?: { enabled?: unknown; mode?: unknown };
  };
  const enabled = s.voice?.enabled ?? s.voiceEnabled;
  if (enabled !== true) return 'Voice is off in Claude Code on this machine: run /voice in a workspace first';
  if (s.voice?.mode !== undefined && s.voice.mode !== 'hold') {
    return 'Claude voice needs Claude Code’s voice mode set to hold (/config)';
  }
  return null;
}

// One dictation as the phone streams it. `done` settles once with why it failed, or null
// once the audio has played and space is released.
export interface VoiceSession {
  write(pcm: Uint8Array): void;
  end(): void;
  abort(reason: string): void;
  // Throw the dictation away: Claude writes nothing. Ignored once the dictation ended.
  cancel(): void;
  readonly done: Promise<string | null>;
}

type Deps = { player: VoicePlayerPort; settings: ClaudeSettingsPort };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

class Dictation implements VoiceSession {
  readonly done: Promise<string | null>;
  private resolve!: (result: string | null) => void;
  private queue: Uint8Array[] = [];
  private stream: VoiceStream | null = null;
  private ended = false;
  private cancelling = false;
  private finished = false;
  private hold: ReturnType<typeof setInterval> | undefined;
  private lead: ReturnType<typeof setTimeout> | undefined;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private draining: ReturnType<typeof setTimeout> | undefined;
  private readonly max: ReturnType<typeof setTimeout>;

  constructor(
    private readonly deps: Deps,
    private readonly pressSpace: () => void,
    private readonly release: () => void,
    private readonly pane?: VoicePane,
  ) {
    this.done = new Promise((resolve) => (this.resolve = resolve));
    this.max = setTimeout(() => this.abort('Dictation stopped: it ran past 5 minutes'), MAX_MS);
    this.touch();
    void this.begin();
  }

  write(pcm: Uint8Array): void {
    if (this.finished || this.ended) return;
    this.touch();
    if (this.stream) this.stream.write(pcm);
    else this.queue.push(pcm);
  }

  end(): void {
    if (this.finished || this.ended || this.cancelling) return;
    this.ended = true;
    clearTimeout(this.idle);
    if (this.stream) this.drain(this.stream);
  }

  abort(reason: string): void {
    this.stream?.abort();
    this.finish(reason);
  }

  cancel(): void {
    if (this.finished || this.ended || this.cancelling) return;
    this.cancelling = true;
    clearTimeout(this.lead);
    clearTimeout(this.idle);
    this.queue = [];
    this.stream?.abort();
    this.stream = null;
    // Nothing pressed yet (the settings are still being read): nothing to undo.
    if (!this.hold) return this.finish(null);
    void this.cancelOnceListening(Date.now());
  }

  // The hold goes on until Claude shows it records, so the key lands while it still listens.
  private async cancelOnceListening(since: number): Promise<void> {
    const pane = this.pane;
    if (!pane) return this.finish(NOT_LISTENING);
    while (!this.finished) {
      const listening = await pane.listening().catch(() => false);
      if (this.finished) return;
      if (listening) {
        clearInterval(this.hold);
        try {
          pane.pressCancel();
        } catch {
          // A dead pty: the release below is all that is left.
        }
        return this.finish(null);
      }
      if (Date.now() - since >= CANCEL_WAIT_MS) return this.finish(NOT_LISTENING);
      await new Promise((resolve) => setTimeout(resolve, CANCEL_POLL_MS));
    }
  }

  private async begin(): Promise<void> {
    const problem = voiceSettingsProblem(await this.deps.settings.read().catch(() => null));
    if (this.finished || this.cancelling) return;
    if (problem) return this.finish(problem);
    const press = () => {
      try {
        this.pressSpace();
      } catch {
        // A dead pty must not throw out of the interval and take the agent down.
      }
    };
    this.hold = setInterval(press, HOLD_REPEAT_MS);
    press();
    this.lead = setTimeout(() => this.play(), LEAD_MS);
  }

  private play(): void {
    if (this.finished || this.cancelling) return;
    let stream: VoiceStream;
    try {
      stream = this.deps.player.open();
    } catch (e) {
      return this.finish(errorText(e));
    }
    this.stream = stream;
    // A player that dies mid-stream (no loopback, say) ends the dictation now, not at the end.
    stream.played.catch((e: unknown) => {
      // A cancel kills the player itself; its death must not end the hold before the key lands.
      if (!this.cancelling) this.finish(errorText(e));
    });
    for (const pcm of this.queue.splice(0)) stream.write(pcm);
    if (this.ended) this.drain(stream);
  }

  private drain(stream: VoiceStream): void {
    this.draining = setTimeout(() => this.abort('Dictation stopped: playback did not finish'), DRAIN_MS);
    void stream.end().then(
      () => setTimeout(() => this.finish(null), TAIL_MS),
      (e: unknown) => this.finish(errorText(e)),
    );
  }

  private touch(): void {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.abort('Dictation stopped: the phone stopped sending audio'), IDLE_MS);
  }

  private finish(result: string | null): void {
    if (this.finished) return;
    this.finished = true;
    clearInterval(this.hold);
    clearTimeout(this.lead);
    clearTimeout(this.idle);
    clearTimeout(this.draining);
    clearTimeout(this.max);
    this.queue = [];
    this.release();
    this.resolve(result);
  }
}

// Plays the phone's dictation into the machine's virtual mic as it arrives, while holding
// space in a workspace, so Claude Code's own /voice transcribes it into the prompt. One
// dictation at a time per machine: there is one virtual mic.
export class ClaudeVoice {
  private busy = false;

  constructor(private readonly deps: Deps) {}

  available(): Promise<boolean> {
    return this.deps.player.available();
  }

  start(pressSpace: () => void, pane?: VoicePane): VoiceSession {
    if (this.busy) {
      const done = Promise.resolve('Claude voice is already in use on this machine');
      return { write: () => undefined, end: () => undefined, abort: () => undefined, cancel: () => undefined, done };
    }
    this.busy = true;
    return new Dictation(this.deps, pressSpace, () => (this.busy = false), pane);
  }
}
