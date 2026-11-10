import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import DictationSetup from './DictationSetup.svelte';
import { CLAUDE_VOICE_DOCS_URL, PROVIDER_LINKS } from '../core/dictation-setup';

describe('DictationSetup', () => {
  it('points a machine without Claude voice at the setup guide, on main', () => {
    render(DictationSetup, { props: { options: [{ kind: 'claude', state: 'setup' }], onOpenSettings: vi.fn(), onClose: vi.fn() } });
    expect(screen.getByText(/if this machine runs Linux/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Machine setup guide' })).toHaveAttribute('href', CLAUDE_VOICE_DOCS_URL);
    expect(CLAUDE_VOICE_DOCS_URL).toContain('/blob/main/docs/SETUP-MACHINE.md');
  });

  it('gives the reason, not setup steps, where the machine has Claude voice', () => {
    render(DictationSetup, { props: { options: [{ kind: 'claude', state: 'not-claude' }], onOpenSettings: vi.fn(), onClose: vi.fn() } });
    expect(screen.getByText(/in a Claude Code workspace/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Machine setup guide' })).toBeNull();
  });

  it('opens Settings at the key, or that provider’s how-to', async () => {
    const onOpenSettings = vi.fn();
    render(DictationSetup, { props: { options: [{ kind: 'key', provider: 'openrouter' }], onOpenSettings, onClose: vi.fn() } });
    await fireEvent.click(screen.getByRole('button', { name: 'How to get an OpenRouter key' }));
    expect(screen.getByRole('dialog', { name: 'Get an OpenRouter key' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the API keys page' })).toHaveAttribute('href', PROVIDER_LINKS.openrouter.keys);
    await fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(onOpenSettings).toHaveBeenCalledWith('openrouter');
  });

  it('shows the command that stores a key on the machine, per provider still missing one', () => {
    render(DictationSetup, { props: { options: [{ kind: 'machine', providers: ['elevenlabs', 'openrouter'] }], onOpenSettings: vi.fn(), onClose: vi.fn() } });
    expect(screen.getByRole('heading', { name: 'A key on this machine' })).toBeInTheDocument();
    expect(screen.getByText('tarfa dictation-key set elevenlabs')).toBeInTheDocument();
    expect(screen.getByText('tarfa dictation-key set openrouter')).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(DictationSetup, { props: { options: [{ kind: 'key', provider: 'elevenlabs' }], onOpenSettings: vi.fn(), onClose } });
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on a tap on the scrim, but not on a click left over from the tap that opened it', async () => {
    const onClose = vi.fn();
    const { container } = render(DictationSetup, { props: { options: [{ kind: 'key', provider: 'elevenlabs' }], onOpenSettings: vi.fn(), onClose } });
    const scrim = container.querySelector('.scrim')!;
    await fireEvent.click(scrim);
    expect(onClose).not.toHaveBeenCalled();
    await fireEvent.pointerDown(scrim);
    await fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
