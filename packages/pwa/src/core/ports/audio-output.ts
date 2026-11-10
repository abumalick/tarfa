// The one <audio> element a reading plays through, faked in tests. `load` replaces the clip and
// its events; only the clip loaded last fires them.
export interface AudioOutput {
  load(clip: Blob, events: { ready: (duration: number) => void; end: () => void; error: () => void }): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  time(): number;
  setRate(rate: number): void;
  // Stops and drops the clip.
  clear(): void;
  // Called in the tap that asks for a reply: the clip arrives after the gesture, and iOS lets an
  // element play on its own only once it played inside one.
  unlock(): void;
}
