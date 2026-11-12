import type { AudioRecorder } from './ports/audio-recorder';

export interface HeldLock {
  release(): Promise<void>;
}

// Keeps the screen on while a dictation records: a phone that sleeps mid-sentence stops the
// microphone and the stream. The lock is a comfort, never a reason to fail the dictation.
export class WakeLockRecorder implements AudioRecorder {
  private held: Promise<HeldLock | null> | null = null;

  constructor(
    private readonly inner: AudioRecorder,
    private readonly request: () => Promise<HeldLock>,
  ) {}

  async start(): Promise<void> {
    await this.inner.start();
    this.held = this.request().catch(() => null);
  }

  async stop(): Promise<Blob> {
    this.releaseLock();
    return this.inner.stop();
  }

  discard(): void {
    this.releaseLock();
    this.inner.discard();
  }

  private releaseLock(): void {
    const held = this.held;
    this.held = null;
    // Released whenever it is granted, even after the recording ended.
    void held?.then((lock) => lock?.release().catch(() => undefined));
  }
}
