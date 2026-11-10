import { afterEach, describe, it, expect, vi } from 'vitest';
import { setLanguage } from '../i18n.svelte';
import { render, screen, fireEvent } from '@testing-library/svelte';
import DictationPresets from './DictationPresets.svelte';
import { DEFAULT_CLEANUP_PROMPT, DEFAULT_PRESETS, type DictationPreset } from '../core/dictation-presets';

// Most cases edit a list without the default Claude voice entry, as a user who removed it has.
const withoutClaude = DEFAULT_PRESETS.filter((p) => ['scribe', 'clean', 'fast'].includes(p.id));
const byId = (id: string) => DEFAULT_PRESETS.find((p) => p.id === id)!;

function fakeStore(presets: DictationPreset[] = [...withoutClaude], extra: { currentPreset?: DictationPreset; addingPreset?: boolean } = {}) {
  return {
    dictationPresets: presets,
    currentPreset: presets[0],
    addingPreset: false,
    ...extra,
    saveDictationPresets: vi.fn(),
    resetDictationPresets: vi.fn(),
  };
}
const saved = (store: ReturnType<typeof fakeStore>) => store.saveDictationPresets.mock.calls.at(-1)![0] as DictationPreset[];

describe('DictationPresets', () => {
  it('lists each preset with its badge', () => {
    render(DictationPresets, { props: { store: fakeStore() as never } });
    expect(screen.getByRole('button', { name: /Edit Scribe/ })).toHaveTextContent('EL');
    expect(screen.getByRole('button', { name: /Edit Clean up/ })).toBeInTheDocument();
  });

  it('lists Claude voice first among the defaults, falling back to Scribe', async () => {
    render(DictationPresets, { props: { store: fakeStore([...DEFAULT_PRESETS]) as never } });
    const edits = screen.getAllByRole('button', { name: /^Edit / });
    expect(edits[0]).toHaveAccessibleName(/Edit Claude voice/);
    expect(edits[0]).toHaveTextContent('CV');
    await fireEvent.click(edits[0]!);
    expect(screen.getByLabelText('Fallback')).toHaveValue('scribe');
  });

  it('highlights the preset in use', () => {
    render(DictationPresets, { props: { store: fakeStore(undefined, { currentPreset: byId('fast') }) as never } });
    expect(screen.getByRole('button', { name: /Edit Fast/ }).closest('li')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /Edit Scribe/ }).closest('li')).not.toHaveAttribute('aria-current');
    expect(screen.getByText('In use')).toBeInTheDocument();
  });

  it('opens a new preset when the mic menu asked for one, once', () => {
    const store = fakeStore(undefined, { addingPreset: true });
    render(DictationPresets, { props: { store: store as never } });
    expect(screen.getByLabelText('Prompt')).toHaveValue(DEFAULT_CLEANUP_PROMPT);
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(store.addingPreset).toBe(false);
  });

  it('edits in a modal that Cancel and Escape close without saving', async () => {
    const store = fakeStore();
    render(DictationPresets, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /Edit Clean up/ }));
    expect(screen.getByRole('dialog', { name: 'Edit preset' })).toHaveAttribute('aria-modal', 'true');
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Add preset' }));
    expect(screen.getByRole('dialog', { name: 'New preset' })).toBeInTheDocument();
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(store.saveDictationPresets).not.toHaveBeenCalled();
  });

  it('edits a preset and saves the whole list', async () => {
    const store = fakeStore();
    render(DictationPresets, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /Edit Clean up/ }));
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Tidy' } });
    await fireEvent.input(screen.getByLabelText('Prompt'), { target: { value: 'Tidy it.' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));
    expect(saved(store)[1]).toMatchObject({ id: 'clean', name: 'Tidy', prompt: 'Tidy it.' });
    expect(saved(store)).toHaveLength(3);
  });

  it('shows OpenRouter fields only for an OpenRouter preset', async () => {
    render(DictationPresets, { props: { store: fakeStore() as never } });
    await fireEvent.click(screen.getByRole('button', { name: /Edit Scribe/ }));
    expect(screen.queryByLabelText('Model')).toBeNull();
    await fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openrouter' } });
    expect(screen.getByLabelText('Model')).toBeInTheDocument();
    expect(screen.getByLabelText('Prompt').tagName).toBe('TEXTAREA');
  });

  it('picks the Scribe model, and takes languages for v3 only', async () => {
    const store = fakeStore();
    render(DictationPresets, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit Scribe' }));
    expect(screen.getByLabelText('Scribe model')).toHaveValue('scribe_v2');
    expect(screen.queryByLabelText('Languages')).toBeNull();
    await fireEvent.change(screen.getByLabelText('Scribe model'), { target: { value: 'scribe_v3' } });
    await fireEvent.input(screen.getByLabelText('Languages'), { target: { value: 'FR, en ar' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));
    expect(saved(store)[0]).toEqual({ id: 'scribe', name: 'Scribe', badge: 'EL', provider: 'elevenlabs', model: 'scribe_v3', languages: ['fr', 'en', 'ar'] });
  });

  it('shows a v3 preset with its model and languages, and refuses a bad code', async () => {
    const v3: DictationPreset = { id: 'm', name: 'Multi', badge: 'E3', provider: 'elevenlabs', model: 'scribe_v3', languages: ['fr', 'en'] };
    const store = fakeStore([v3]);
    render(DictationPresets, { props: { store: store as never } });
    expect(screen.getByRole('button', { name: 'Edit Multi' })).toHaveTextContent('Scribe v3 · fr, en');
    await fireEvent.click(screen.getByRole('button', { name: 'Edit Multi' }));
    expect(screen.getByLabelText('Languages')).toHaveValue('fr, en');
    await fireEvent.input(screen.getByLabelText('Languages'), { target: { value: 'french' } });
    expect(screen.getByRole('button', { name: 'Save preset' })).toBeDisabled();
    expect(screen.getByText(/2- or 3-letter ISO codes/)).toBeInTheDocument();
  });

  it('saves a v3 preset with no languages as auto-detect', async () => {
    const store = fakeStore();
    render(DictationPresets, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit Scribe' }));
    await fireEvent.change(screen.getByLabelText('Scribe model'), { target: { value: 'scribe_v3' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));
    expect(saved(store)[0]).toEqual({ id: 'scribe', name: 'Scribe', badge: 'EL', provider: 'elevenlabs', model: 'scribe_v3' });
  });

  it('will not save an invalid preset, and says why', async () => {
    const store = fakeStore();
    render(DictationPresets, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /Edit Clean up/ }));
    await fireEvent.input(screen.getByLabelText('Badge'), { target: { value: 'TOOLONG' } });
    expect(screen.getByRole('button', { name: 'Save preset' })).toBeDisabled();
    expect(screen.getByText(/badge must be 1 to 3/i)).toBeInTheDocument();
  });

  it('adds a preset prefilled with the cleanup prompt', async () => {
    const store = fakeStore();
    render(DictationPresets, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add preset' }));
    expect(screen.getByLabelText('Model')).toHaveValue('google/gemini-3.8-flash');
    expect(screen.getByLabelText('Prompt')).toHaveValue(DEFAULT_CLEANUP_PROMPT);
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Translate' } });
    await fireEvent.input(screen.getByLabelText('Badge'), { target: { value: 'TR' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));
    const list = saved(store);
    expect(list).toHaveLength(4);
    expect(list[3]).toMatchObject({ name: 'Translate', badge: 'TR', provider: 'openrouter' });
    expect(new Set(list.map((p) => p.id)).size).toBe(4);
  });

  it('adds a Claude voice preset, with no model or prompt', async () => {
    const store = fakeStore();
    render(DictationPresets, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add preset' }));
    await fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'claude' } });
    expect(screen.queryByLabelText('Model')).toBeNull();
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Claude voice' } });
    await fireEvent.input(screen.getByLabelText('Badge'), { target: { value: 'CV' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));
    expect(saved(store)[3]).toEqual({ id: expect.any(String), name: 'Claude voice', badge: 'CV', provider: 'claude' });
  });

  it('saves the Claude voice preset’s fallback', async () => {
    const store = fakeStore();
    render(DictationPresets, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add preset' }));
    await fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'claude' } });
    const fallback = screen.getByLabelText('Fallback');
    expect([...fallback.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['First available preset', 'Scribe', 'Clean up', 'Fast']);
    await fireEvent.change(fallback, { target: { value: 'clean' } });
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Claude voice' } });
    await fireEvent.input(screen.getByLabelText('Badge'), { target: { value: 'CV' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));
    expect(saved(store)[3]).toEqual({ id: expect.any(String), name: 'Claude voice', badge: 'CV', provider: 'claude', fallbackId: 'clean' });
  });

  it('deletes and reorders', async () => {
    const store = fakeStore();
    render(DictationPresets, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: 'Move Fast up' }));
    expect(saved(store).map((p) => p.id)).toEqual(['scribe', 'fast', 'clean']);
    await fireEvent.click(screen.getByRole('button', { name: 'Delete Scribe' }));
    expect(saved(store).map((p) => p.id)).toEqual(['clean', 'fast']);
  });

  it('never deletes the last preset', () => {
    render(DictationPresets, { props: { store: fakeStore([byId('scribe')]) as never } });
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
  });

  it('resets to the defaults after a confirmation', async () => {
    const store = fakeStore();
    render(DictationPresets, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(store.resetDictationPresets).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm reset' }));
    expect(store.resetDictationPresets).toHaveBeenCalled();
  });
});

describe('DictationPresets in French', () => {
  afterEach(() => setLanguage('en'));

  it('offers to add a preset in French', () => {
    setLanguage('fr');
    render(DictationPresets, { props: { store: fakeStore() as never } });
    expect(screen.getByRole('button', { name: 'Ajouter un préréglage' })).toBeTruthy();
  });
});
