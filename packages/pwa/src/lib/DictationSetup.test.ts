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

  it("opens this machine's page at the key, or that provider’s how-to, with the operator's command beside", async () => {
    const onOpenSettings = vi.fn();
    render(DictationSetup, { props: { options: [{ kind: 'key', provider: 'openrouter', route: 'page' }], onOpenSettings, onClose: vi.fn() } });
    expect(screen.getByText(/on this machine's page in Settings/)).toBeInTheDocument();
    expect(screen.getByText('tarfa dictation-key set openrouter')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'How to get an OpenRouter key' }));
    expect(screen.getByRole('dialog', { name: 'Get an OpenRouter key' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the API keys page' })).toHaveAttribute('href', PROVIDER_LINKS.openrouter.keys);
    expect(screen.getByText(/stored on the machine/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: "Open this machine's page" }));
    expect(onOpenSettings).toHaveBeenCalledWith('openrouter');
  });

  it('gives only the command, and the update note, where the agent takes no key from the phone', () => {
    render(DictationSetup, { props: { options: [{ kind: 'key', provider: 'elevenlabs', route: 'cli' }], onOpenSettings: vi.fn(), onClose: vi.fn() } });
    expect(screen.getByText('tarfa dictation-key set elevenlabs')).toBeInTheDocument();
    expect(screen.getByText(/Update this machine's agent/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open this machine's page/ })).toBeNull();
  });

  it('asks for an agent update where the machine keeps no keys at all', () => {
    render(DictationSetup, { props: { options: [{ kind: 'key', provider: 'elevenlabs', route: 'update' }], onOpenSettings: vi.fn(), onClose: vi.fn() } });
    expect(screen.getByText(/Update this machine's agent/)).toBeInTheDocument();
    expect(screen.queryByText(/tarfa dictation-key/)).toBeNull();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(DictationSetup, { props: { options: [{ kind: 'key', provider: 'elevenlabs', route: 'page' }], onOpenSettings: vi.fn(), onClose } });
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on a tap on the scrim, but not on a click left over from the tap that opened it', async () => {
    const onClose = vi.fn();
    const { container } = render(DictationSetup, { props: { options: [{ kind: 'key', provider: 'elevenlabs', route: 'page' }], onOpenSettings: vi.fn(), onClose } });
    const scrim = container.querySelector('.scrim')!;
    await fireEvent.click(scrim);
    expect(onClose).not.toHaveBeenCalled();
    await fireEvent.pointerDown(scrim);
    await fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
