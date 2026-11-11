import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../i18n.svelte';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import PairMachine from './PairMachine.svelte';

function fakeStore(accepts: (text: string) => boolean | 'declined' = () => true) {
  return {
    pairFromLink: vi.fn((text: string): { name: string } | { error: string } | { declined: true } => {
      const verdict = accepts(text);
      if (verdict === 'declined') return { declined: true };
      return verdict ? { name: 'dev' } : { error: 'That is not a Tarfa pairing code. Run `tarfa pair` on the machine for a fresh one.' };
    }),
    openWorkspaceLink: vi.fn((text: string) => text.includes('#open?')),
  };
}

describe('PairMachine', () => {
  it('pairs from a pasted code', async () => {
    const store = fakeStore();
    render(PairMachine, { props: { store, scan: vi.fn() } });
    await fireEvent.input(screen.getByLabelText(/paste a pairing code/i), { target: { value: 'https://p/#pair?x' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Pair' }));
    expect(store.pairFromLink).toHaveBeenCalledWith('https://p/#pair?x');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('opens a pasted workspace link instead of pairing with it', async () => {
    const store = fakeStore();
    render(PairMachine, { props: { store, scan: vi.fn() } });
    await fireEvent.input(screen.getByLabelText(/paste a pairing code/i), { target: { value: 'https://p/#open?k=x&w=y' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Pair' }));
    expect(store.openWorkspaceLink).toHaveBeenCalledWith('https://p/#open?k=x&w=y');
    expect(store.pairFromLink).not.toHaveBeenCalled();
  });

  it('says so when the pasted text is not a pairing code', async () => {
    render(PairMachine, { props: { store: fakeStore(() => false), scan: vi.fn() } });
    await fireEvent.input(screen.getByLabelText(/paste a pairing code/i), { target: { value: 'hello' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Pair' }));
    expect(screen.getByRole('alert').textContent).toMatch(/not a Tarfa pairing code/);
  });

  it('scans until a code pairs, then stops the camera', async () => {
    const store = fakeStore((text) => text === 'good');
    const stop = vi.fn();
    let emit: (text: string) => void = () => undefined;
    const scan = vi.fn(async (_video: HTMLVideoElement, onText: (text: string) => void) => {
      emit = onText;
      return stop;
    });
    render(PairMachine, { props: { store, scan } });
    await fireEvent.click(screen.getByRole('button', { name: /scan qr code/i }));
    await tick();
    expect(scan).toHaveBeenCalledWith(expect.any(HTMLVideoElement), expect.any(Function));
    emit('a shop receipt');
    await tick();
    expect(stop).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/not a Tarfa pairing code/);
    emit('good');
    await tick();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /scan qr code/i })).toBeTruthy();
  });

  // The owner said no to the pairing question: scanning on would ask again at the next frame.
  it('stops the camera when the owner declines a scanned code, and clears an earlier refusal', async () => {
    const stop = vi.fn();
    let emit: (text: string) => void = () => undefined;
    const scan = vi.fn(async (_video: HTMLVideoElement, onText: (text: string) => void) => {
      emit = onText;
      return stop;
    });
    render(PairMachine, { props: { store: fakeStore((text) => (text === 'receipt' ? false : 'declined')), scan } });
    await fireEvent.click(screen.getByRole('button', { name: /scan qr code/i }));
    await tick();
    emit('receipt');
    await tick();
    expect(screen.getByRole('alert')).toBeTruthy();
    emit('TARFA0123');
    await tick();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('explains a refused camera and points to pasting the code', async () => {
    const scan = vi.fn(async () => {
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    });
    render(PairMachine, { props: { store: fakeStore(), scan } });
    await fireEvent.click(screen.getByRole('button', { name: /scan qr code/i }));
    await tick();
    await tick();
    expect(screen.getByRole('alert').textContent).toMatch(/refused.*paste the pairing code/);
  });
  it('pairs from the code on the clipboard, read on the tap', async () => {
    const store = fakeStore();
    const readClipboard = vi.fn(async () => 'https://p/#pair?x');
    render(PairMachine, { props: { store, scan: vi.fn(), readClipboard } });
    await fireEvent.click(screen.getByRole('button', { name: 'Paste pairing code' }));
    await tick();
    expect(store.pairFromLink).toHaveBeenCalledWith('https://p/#pair?x');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('points to the field when the clipboard cannot be read', async () => {
    const readClipboard = vi.fn(async () => {
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    });
    render(PairMachine, { props: { store: fakeStore(), scan: vi.fn(), readClipboard } });
    await fireEvent.click(screen.getByRole('button', { name: 'Paste pairing code' }));
    await tick();
    expect(screen.getByRole('alert').textContent).toMatch(/clipboard.*paste it in the field below/i);
  });
});

describe('PairMachine in French', () => {
  afterEach(() => setLanguage('en'));

  it('offers the scan in French', () => {
    setLanguage('fr');
    render(PairMachine, { props: { store: fakeStore(), scan: vi.fn() } });
    expect(screen.getByRole('button', { name: 'Scanner le QR code' })).toBeTruthy();
  });
});
