import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import UpdatePill from './UpdatePill.svelte';
import { setLanguage } from '../i18n.svelte';

function fakeStore(over: Record<string, unknown> = {}) {
  return {
    updateReady: false,
    incomingBuildLabel: null,
    applyUpdate: vi.fn(),
    ...over,
  };
}

describe('UpdatePill', () => {
  it('renders nothing when no update is pending', () => {
    render(UpdatePill, { props: { store: fakeStore() as never } });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('names the incoming worktree build', () => {
    render(UpdatePill, { props: { store: fakeStore({ updateReady: true, incomingBuildLabel: 'feat-x' }) as never } });
    expect(screen.getByRole('button')).toHaveTextContent('feat-x');
    expect(screen.getByRole('button', { name: /^feat-x · new build from feat-x$/i })).toBeInTheDocument();
  });

  it('stays short for a main build', () => {
    render(UpdatePill, { props: { store: fakeStore({ updateReady: true, incomingBuildLabel: 'main' }) as never } });
    expect(screen.getByRole('button')).toHaveTextContent('Update');
    expect(screen.getByRole('button', { name: /^update · new version available$/i })).toBeInTheDocument();
    expect(screen.queryByText(/main/)).not.toBeInTheDocument();
  });

  it('stays short when the label is unknown', () => {
    render(UpdatePill, { props: { store: fakeStore({ updateReady: true, incomingBuildLabel: null }) as never } });
    expect(screen.getByRole('button', { name: /new version available/i })).toHaveTextContent('Update');
  });

  it('applies the update on tap', async () => {
    const store = fakeStore({ updateReady: true, incomingBuildLabel: 'feat-x' });
    render(UpdatePill, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button'));
    expect(store.applyUpdate).toHaveBeenCalled();
  });
});

describe('UpdatePill in French', () => {
  it('renders its text in French', () => {
    setLanguage('fr');
    try {
      render(UpdatePill, { props: { store: fakeStore({ updateReady: true, incomingBuildLabel: 'main' }) as never } });
      expect(screen.getByRole('button', { name: /^mettre à jour · mise à jour disponible$/i })).toHaveTextContent('Mettre à jour');
    } finally {
      setLanguage('en');
    }
  });
});
