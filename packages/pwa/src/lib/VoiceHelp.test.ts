import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import VoiceHelp from './VoiceHelp.svelte';
import type { VoicePlatform } from './voice-platform';

const show = (platform: VoicePlatform, trouble: 'silent' | 'failed') =>
  render(VoiceHelp, { props: { platform, trouble, onClose: () => undefined } });

describe('VoiceHelp', () => {
  // A silent voice on Android Chrome is what a missing Google engine looks like.
  it('leads a silent Android Chrome voice to the engine install', () => {
    show('android-chrome', 'silent');
    const panel = screen.getByTestId('voice-help');
    expect(within(panel).getAllByRole('listitem')[1]!.textContent).toContain('Play Store');
    expect(within(panel).getAllByRole('list')).toHaveLength(1);
    expect(within(panel).queryByRole('heading', { name: 'Still failing?' })).toBeNull();
  });

  // A voice that answers with an error has an engine: Chrome lost it (the engine updated
  // under it) and finds it again only when it restarts.
  it('leads a failed Android Chrome voice to restarting Chrome, the install after it', () => {
    show('android-chrome', 'failed');
    const panel = screen.getByTestId('voice-help');
    const first = within(panel).getAllByRole('list')[0]!;
    expect(first.textContent).toContain('Force stop');
    expect(first.textContent).not.toContain('Play Store');
    expect(within(panel).getByRole('heading', { name: 'Still failing?' })).toBeTruthy();
    expect(within(panel).getByRole('link', { name: 'Open in the Play Store' })).toBeTruthy();
  });

  it('keeps one list elsewhere, failed or not', () => {
    show('ios', 'failed');
    const panel = screen.getByTestId('voice-help');
    expect(within(panel).getAllByRole('list')).toHaveLength(1);
    expect(within(panel).queryByRole('heading', { name: 'Still failing?' })).toBeNull();
  });
});
