import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import OpenInAppFirst from './OpenInAppFirst.svelte';

const LINK = 'https://p/#open?k=x&w=app-3';

describe('OpenInAppFirst', () => {
  it('copies the held link, and opens it in this browser only on request', async () => {
    const store = { heldWorkspaceLink: LINK, openHeldLinkHere: vi.fn() };
    const copy = vi.fn(async () => undefined);
    render(OpenInAppFirst, { props: { store, copy } });
    await fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await tick();
    expect(copy).toHaveBeenCalledWith(LINK);
    expect(store.openHeldLinkHere).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: /this browser/i }));
    expect(store.openHeldLinkHere).toHaveBeenCalled();
  });

  it('shows the link to copy by hand when the clipboard refuses', async () => {
    const copy = vi.fn(async () => {
      throw new Error('denied');
    });
    render(OpenInAppFirst, { props: { store: { heldWorkspaceLink: LINK, openHeldLinkHere: vi.fn() }, copy } });
    await fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await tick();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(LINK);
  });
});
