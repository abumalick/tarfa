import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ReadAloudVoices from './ReadAloudVoices.svelte';
import type { TarfaStore } from '../store.svelte';
import { SynthesisError, type ListedVoice } from '../core/ports/text-to-speech';
import type { ReadAloudVoiceChoice } from '../core/read-aloud-voice';

const voices: ListedVoice[] = [
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', description: 'british, male', previewUrl: null },
  { id: 'v2', name: 'Ann', description: '', previewUrl: 'https://x.test/a.mp3' },
];

function fakeStore(over: Partial<{ machine: string | null; list: () => Promise<ListedVoice[]> }> = {}) {
  const state = {
    readAloudVoice: { source: 'device', voice: null } as ReadAloudVoiceChoice,
    readAloudFocus: false,
    elevenLabsCatalogMachine: over.machine === undefined ? 'Box' : over.machine,
    listElevenLabsVoices: vi.fn(over.list ?? (async () => voices)),
    previewElevenLabsVoice: vi.fn(async () => new Blob()),
    setReadAloudSource: vi.fn(),
    setElevenLabsVoice: vi.fn(),
  };
  return state;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('ReadAloudVoices', () => {
  it('switches the voice source', async () => {
    const store = fakeStore();
    render(ReadAloudVoices, { props: { store: store as unknown as TarfaStore } });
    await fireEvent.click(screen.getByRole('radio', { name: /ElevenLabs · George/ }));
    expect(store.setReadAloudSource).toHaveBeenCalledWith('elevenlabs');
  });

  it('lists the voices on request, naming the machine, and picks one', async () => {
    const store = fakeStore();
    render(ReadAloudVoices, { props: { store: store as unknown as TarfaStore } });
    expect(store.listElevenLabsVoices).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Show the voices' }));
    await flush();
    expect(screen.getByText(/ElevenLabs account on Box/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /George \(default\)/ })).toHaveAttribute('aria-selected', 'true');
    await fireEvent.click(screen.getByRole('option', { name: /Ann/ }));
    expect(store.setElevenLabsVoice).toHaveBeenCalledWith({ id: 'v2', name: 'Ann' });
    await fireEvent.click(screen.getByRole('option', { name: /George/ }));
    expect(store.setElevenLabsVoice).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('button', { name: 'Play a sample of Ann' })).toBeInTheDocument();
  });

  it('says why the voices could not be listed', async () => {
    const store = fakeStore({ list: async () => Promise.reject(new SynthesisError('permission', 401)) });
    render(ReadAloudVoices, { props: { store: store as unknown as TarfaStore } });
    await fireEvent.click(screen.getByRole('button', { name: 'Show the voices' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('not allowed to read Voices');
  });

  it('plays a sample, unlocking the element inside the tap, and a second tap during the fetch stops it', async () => {
    const plays: string[] = [];
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      plays.push(this.src);
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:s${(n += 1)}`);
    URL.revokeObjectURL = vi.fn();
    let land: (b: Blob) => void = () => undefined;
    const store = fakeStore();
    store.previewElevenLabsVoice = vi.fn((_url: string, signal?: AbortSignal) => new Promise<Blob>((resolve, reject) => {
      land = resolve;
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    render(ReadAloudVoices, { props: { store: store as unknown as TarfaStore } });
    await fireEvent.click(screen.getByRole('button', { name: 'Show the voices' }));
    await flush();
    await fireEvent.click(screen.getByRole('button', { name: 'Play a sample of Ann' }));
    expect(plays).toEqual(['blob:s1']);
    await fireEvent.click(screen.getByRole('button', { name: 'Stop the sample' }));
    land(new Blob(['mp3']));
    await flush();
    expect(plays).toEqual(['blob:s1']);
    expect(screen.getByRole('button', { name: 'Play a sample of Ann' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    // Played to the end this time.
    await fireEvent.click(screen.getByRole('button', { name: 'Play a sample of Ann' }));
    land(new Blob(['mp3']));
    await flush();
    expect(plays).toEqual(['blob:s1', 'blob:s2', 'blob:s3']);
    await fireEvent.click(screen.getByRole('button', { name: 'Stop the sample' }));
    vi.restoreAllMocks();
  });

  it('points at a machine page when no machine holds a key', () => {
    render(ReadAloudVoices, { props: { store: fakeStore({ machine: null }) as unknown as TarfaStore } });
    expect(screen.queryByRole('button', { name: 'Show the voices' })).toBeNull();
    expect(screen.getByText(/No connected machine holds an ElevenLabs key/)).toBeInTheDocument();
  });
});
