import { describe, it, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import MachineDictationKeys from './MachineDictationKeys.svelte';

function setup(overrides: Record<string, unknown> = {}) {
  const store = {
    statuses: { mac: 'online' } as Record<string, string>,
    keyRoute: vi.fn(() => 'page'),
    machineHasDictationKey: vi.fn((_id: string, p: string) => p === 'elevenlabs'),
    dictationKeySaves: {} as Record<string, unknown>,
    setMachineDictationKey: vi.fn(),
    ...overrides,
  };
  render(MachineDictationKeys, { props: { store: store as never, machine: { id: 'mac', name: 'Mac' } } });
  return store;
}

const card = (provider: string) => within(screen.getByTestId(`machine-key-${provider}`));

describe('MachineDictationKeys', () => {
  it('says which keys the machine holds, never their value', () => {
    setup();
    expect(card('elevenlabs').getByText('Set on this machine')).toBeInTheDocument();
    const field = card('elevenlabs').getByLabelText('ElevenLabs API key') as HTMLInputElement;
    expect(field.value).toBe('');
    expect(field.placeholder).toBe('••••••');
    expect(field.type).toBe('password');
    expect(field.getAttribute('autocomplete')).toBe('new-password');
    expect(card('openrouter').getByText('Not set')).toBeInTheDocument();
    expect(card('openrouter').queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('sends a typed key to this machine, keeping it in the field until the machine stored it', async () => {
    const saves = $state<Record<string, unknown>>({});
    const store = setup({
      get dictationKeySaves() {
        return saves;
      },
    });
    const field = card('openrouter').getByLabelText('OpenRouter API key') as HTMLInputElement;
    await fireEvent.input(field, { target: { value: ' sk-or-v1-testkey2testkey2testkey2testkey2testkey2 ' } });
    await fireEvent.click(card('openrouter').getByRole('button', { name: 'Save key' }));
    expect(store.setMachineDictationKey).toHaveBeenCalledWith('mac', 'openrouter', 'sk-or-v1-testkey2testkey2testkey2testkey2testkey2');
    saves.mac = { openrouter: { state: 'failed', error: 'x' } };
    await tick();
    expect(field.value).toBe(' sk-or-v1-testkey2testkey2testkey2testkey2testkey2 ');
    await fireEvent.click(card('openrouter').getByRole('button', { name: 'Save key' }));
    saves.mac = { openrouter: { state: 'saved' } };
    await tick();
    expect(field.value).toBe('');
  });

  it('refuses a key not shaped like the provider\'s before sending it, until the field changes', async () => {
    const store = setup();
    const field = card('elevenlabs').getByLabelText('ElevenLabs API key') as HTMLInputElement;
    await fireEvent.input(field, { target: { value: 'not-a-key' } });
    await fireEvent.click(card('elevenlabs').getByRole('button', { name: 'Save key' }));
    expect(store.setMachineDictationKey).not.toHaveBeenCalled();
    expect(card('elevenlabs').getByRole('status')).toHaveTextContent(
      'Not saved: this is not an ElevenLabs key. An ElevenLabs key starts with sk_ followed by at least 32 letters and digits.',
    );
    expect(field.value).toBe('not-a-key');
    await fireEvent.input(field, { target: { value: 'not-a-key2' } });
    expect(card('elevenlabs').queryByRole('status')).toBeNull();
  });

  it('says when the key pasted belongs to the other provider', async () => {
    const store = setup();
    await fireEvent.input(card('elevenlabs').getByLabelText('ElevenLabs API key'), {
      target: { value: 'sk-or-v1-testkey2testkey2testkey2testkey2testkey2' },
    });
    await fireEvent.click(card('elevenlabs').getByRole('button', { name: 'Save key' }));
    expect(store.setMachineDictationKey).not.toHaveBeenCalled();
    expect(card('elevenlabs').getByRole('status')).toHaveTextContent(
      'Not saved: this looks like an OpenRouter key. Paste it in the OpenRouter field, and an ElevenLabs key here.',
    );
  });

  it('removes a key from the machine', async () => {
    const store = setup();
    await fireEvent.click(card('elevenlabs').getByRole('button', { name: 'Remove' }));
    expect(store.setMachineDictationKey).toHaveBeenCalledWith('mac', 'elevenlabs', null);
  });

  it('drops a refusal once the key is removed', async () => {
    setup();
    await fireEvent.input(card('elevenlabs').getByLabelText('ElevenLabs API key'), { target: { value: 'not-a-key' } });
    await fireEvent.click(card('elevenlabs').getByRole('button', { name: 'Save key' }));
    expect(card('elevenlabs').getByRole('status')).toBeInTheDocument();
    await fireEvent.click(card('elevenlabs').getByRole('button', { name: 'Remove' }));
    expect(card('elevenlabs').queryByRole('status')).toBeNull();
  });

  it('says what became of the last save', () => {
    setup({
      dictationKeySaves: { mac: { elevenlabs: { state: 'saved' }, openrouter: { state: 'failed', error: 'a key holds no whitespace' } } },
    });
    expect(card('elevenlabs').getByRole('status')).toHaveTextContent('Saved on Mac');
    expect(card('openrouter').getByRole('status')).toHaveTextContent('Not saved: a key holds no whitespace');
  });

  it('holds the buttons while a save is pending', () => {
    setup({ dictationKeySaves: { mac: { elevenlabs: { state: 'pending', id: '1', removing: false } } } });
    expect(card('elevenlabs').getByRole('button', { name: 'Remove' })).toBeDisabled();
    expect(card('elevenlabs').getByRole('status')).toHaveTextContent('Saving…');
  });

  it('asks for an agent update instead of a field where the agent takes no key', () => {
    setup({ keyRoute: vi.fn(() => 'cli') });
    expect(screen.getByTestId('machine-keys-update')).toHaveTextContent("Update this machine's agent to store a key here.");
    expect(screen.getByText('tarfa dictation-key set openrouter')).toBeInTheDocument();
    expect(screen.queryByLabelText(/API key/)).toBeNull();
    expect(card('elevenlabs').getByText('Set on this machine')).toBeInTheDocument();
  });

  it('offers no command to an agent that keeps no keys at all', () => {
    setup({ keyRoute: vi.fn(() => 'update'), machineHasDictationKey: vi.fn(() => false) });
    expect(screen.getByTestId('machine-keys-update')).toBeInTheDocument();
    expect(screen.queryByText(/tarfa dictation-key/)).toBeNull();
  });

  it('shows nothing to edit while the machine is offline', () => {
    setup({ statuses: {} });
    expect(screen.getByText(/Connect to this machine/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/API key/)).toBeNull();
  });
});
