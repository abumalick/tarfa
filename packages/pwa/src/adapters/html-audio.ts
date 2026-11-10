import type { AudioOutput } from '../core/ports/audio-output';

// A twentieth of a second of silence (8 kHz, 8-bit WAV): what the tap plays to unlock the element.
// A blob, since the CSP's media-src takes no data: URL.
function silence(): Blob {
  const samples = 400;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, 'data');
  view.setUint32(40, samples, true);
  bytes.fill(128, 44);
  return new Blob([bytes], { type: 'audio/wav' });
}

// One <audio> element for every reading, so the unlock a tap gives it holds for the clip that
// arrives later. Null where the browser has no Audio.
export function htmlAudio(): AudioOutput | null {
  if (typeof Audio === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  const el = new Audio();
  el.preload = 'auto';
  let url: string | null = null;
  let detach: (() => void) | null = null;
  let onError: (() => void) | null = null;

  const setSource = (clip: Blob) => {
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(clip);
    el.src = url;
  };
  const release = () => {
    detach?.();
    detach = null;
    onError = null;
    el.pause();
    el.removeAttribute('src');
    el.load();
    if (url) URL.revokeObjectURL(url);
    url = null;
  };

  return {
    load(clip, events) {
      release();
      const ready = () => events.ready(Number.isFinite(el.duration) ? el.duration : 0);
      const end = () => events.end();
      const error = () => events.error();
      el.addEventListener('loadedmetadata', ready, { once: true });
      el.addEventListener('ended', end);
      el.addEventListener('error', error);
      detach = () => {
        el.removeEventListener('loadedmetadata', ready);
        el.removeEventListener('ended', end);
        el.removeEventListener('error', error);
      };
      onError = error;
      setSource(clip);
    },
    play() {
      const failed = onError;
      // A refusal (no unlock reached this element) fails the reading rather than hanging it.
      el.play()?.catch(() => failed?.());
    },
    pause() {
      el.pause();
    },
    seek(seconds) {
      el.currentTime = seconds;
    },
    time() {
      return el.currentTime;
    },
    setRate(rate) {
      el.playbackRate = rate;
    },
    clear: release,
    unlock() {
      release();
      setSource(silence());
      const unlocking = el.src;
      el.play()
        ?.then(() => {
          if (el.src === unlocking) el.pause();
        })
        .catch(() => {});
    },
  };
}
