import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { htmlAudio } from './html-audio';

let played: Array<{ src: string; reject: (e: unknown) => void; resolve: () => void }>;
let revoked: string[];
let urls = 0;

beforeEach(() => {
  played = [];
  revoked = [];
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    return new Promise<void>((resolve, reject) => played.push({ src: this.src, resolve, reject }));
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  URL.createObjectURL = vi.fn(() => `blob:clip-${(urls += 1)}`);
  URL.revokeObjectURL = vi.fn((u: string) => void revoked.push(u));
});
afterEach(() => vi.restoreAllMocks());

const flush = () => new Promise((r) => setTimeout(r, 0));
const events = () => ({ ready: vi.fn(), end: vi.fn(), error: vi.fn() });

describe('htmlAudio', () => {
  it('fails a reading whose start the browser refuses', async () => {
    const audio = htmlAudio()!;
    const e = events();
    audio.load(new Blob(['x']), e);
    audio.play();
    played[0]!.reject(new DOMException('no gesture', 'NotAllowedError'));
    await flush();
    expect(e.error).toHaveBeenCalled();
  });

  it('does not fail a start that a pause cut short', async () => {
    const audio = htmlAudio()!;
    const e = events();
    audio.load(new Blob(['x']), e);
    audio.play();
    audio.pause();
    played[0]!.reject(new DOMException('interrupted', 'AbortError'));
    await flush();
    expect(e.error).not.toHaveBeenCalled();
  });

  it('unlocks with a silent clip on the same element, then plays the reply on it', async () => {
    const audio = htmlAudio()!;
    audio.unlock();
    expect(played).toHaveLength(1);
    audio.load(new Blob(['reply']), events());
    // The unlock's clip was dropped when the reply replaced it.
    expect(revoked).toEqual(['blob:clip-' + (urls - 1)]);
    audio.play();
    expect(played).toHaveLength(2);
    audio.clear();
    expect(revoked).toContain('blob:clip-' + urls);
  });
});
