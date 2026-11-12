import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import UpdateBar from './UpdateBar.svelte';
import { setLanguage } from '../i18n.svelte';

function fakeStore(over: Record<string, unknown> = {}) {
  return {
    updateReady: false,
    incomingBuildLabel: null,
    applyUpdate: vi.fn(),
    ...over,
  };
}

describe('UpdateBar', () => {
  it('renders nothing when no update is pending', () => {
    render(UpdateBar, { props: { store: fakeStore() as never } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says a new version is available, with an Update button, for a main build', () => {
    render(UpdateBar, { props: { store: fakeStore({ updateReady: true, incomingBuildLabel: 'main' }) as never } });
    expect(screen.getByRole('status')).toHaveTextContent('New version available');
    expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
    expect(screen.queryByText(/main/)).not.toBeInTheDocument();
  });

  it('names the incoming worktree build', () => {
    render(UpdateBar, { props: { store: fakeStore({ updateReady: true, incomingBuildLabel: 'feat-x' }) as never } });
    expect(screen.getByRole('status')).toHaveTextContent('New build from feat-x');
  });

  it('stays generic when the label is unknown', () => {
    render(UpdateBar, { props: { store: fakeStore({ updateReady: true, incomingBuildLabel: null }) as never } });
    expect(screen.getByRole('status')).toHaveTextContent('New version available');
  });

  it('applies the update on Update', async () => {
    const store = fakeStore({ updateReady: true, incomingBuildLabel: 'feat-x' });
    render(UpdateBar, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(store.applyUpdate).toHaveBeenCalled();
  });

  it('has no dismiss: the app stays usable until Update is tapped', () => {
    render(UpdateBar, { props: { store: fakeStore({ updateReady: true }) as never } });
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

describe('UpdateBar in French', () => {
  it('renders its text in French', () => {
    setLanguage('fr');
    try {
      render(UpdateBar, { props: { store: fakeStore({ updateReady: true, incomingBuildLabel: 'main' }) as never } });
      expect(screen.getByRole('status')).toHaveTextContent('Mise à jour disponible');
      expect(screen.getByRole('button', { name: 'Mettre à jour' })).toBeInTheDocument();
    } finally {
      setLanguage('en');
    }
  });
});
