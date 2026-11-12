import { afterEach, describe, it, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { setLanguage } from '../i18n.svelte';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import { generateAgentKeys } from '@tarfa/secure-channel';
import Settings from './Settings.svelte';

import { inputLog } from '../core/terminal-input-log';
import { DEFAULT_PRESETS } from '../core/dictation-presets';

const KEY = generateAgentKeys().x25519.publicKey;

function fakeStore(overrides: Record<string, unknown> = {}) {
  return {
    machines: [{ id: 'mac', name: 'Mac', addresses: ['wss://mac'], agentKey: KEY }] as Record<string, unknown>[],
    statuses: {} as Record<string, string>,
    lastConnectionError: {} as Record<string, { message: string; code?: number; at: number }>,
    addMachine: vi.fn(),
    updateMachine: vi.fn(),
    removeMachine: vi.fn(),
    reconnectMachine: vi.fn(),
    toggleMachine: vi.fn(),
    moveMachine: vi.fn(),
    replaceDeviceKey: vi.fn(),
    pairFromLink: vi.fn(() => ({ error: 'nope' })),
    back: vi.fn(),
    goNewMachine: vi.fn(),
    keyRoute: vi.fn(() => 'page'),
    machineHasDictationKey: vi.fn(() => false),
    dictationKeySaves: {},
    setMachineDictationKey: vi.fn(),
    dictationKeySources: vi.fn((): string[] => []),
    dictationPresets: [...DEFAULT_PRESETS],
    saveDictationPresets: vi.fn(),
    resetDictationPresets: vi.fn(),
    shareLinks: false,
    setShareLinks: vi.fn(),
    groupByProject: false,
    setGroupByProject: vi.fn(),
    languageChoice: 'auto',
    dictationKeyFocus: null as { machineId: string; provider: string } | null,
    setLanguageChoice: vi.fn(),
    readAloudVoice: { source: 'device', voice: null },
    readAloudFocus: false,
    elevenLabsCatalogMachine: null,
    setReadAloudSource: vi.fn(),
    setElevenLabsVoice: vi.fn(),
    ...overrides,
  };
}

describe('Settings — machines list', () => {
  it('returns home via the Back button', async () => {
    const store = fakeStore();
    render(Settings, { props: { store: store as never } });
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(store.back).toHaveBeenCalled();
  });

  it('shows each machine with its status, and no way to remove it from the list', () => {
    const store = fakeStore({ statuses: { mac: 'online' } });
    render(Settings, { props: { store: store as never } });
    const mac = screen.getByRole('button', { name: /^Mac/ });
    expect(mac).toHaveTextContent('Online');
    expect(within(mac.closest('ul')!).queryByRole('button', { name: /remove|delete/i })).toBeNull();
  });

  it("shows each machine's first address, and how many more it has", () => {
    const store = fakeStore({
      machines: [
        { id: 'a', name: 'Cloud box', addresses: ['wss://cloud.example.com/'], agentKey: KEY },
        { id: 'b', name: 'Home box', addresses: ['wss://box.example.ts.net:10000/abu', 'wss://box.example.ts.net:8443/abu'], agentKey: KEY },
      ],
    });
    render(Settings, { props: { store: store as never } });
    const [cloudHost, homeHost] = screen.getAllByTestId('machine-host');
    expect(cloudHost?.parentElement).toHaveTextContent(/^Cloud box\s*cloud\.example\.com$/);
    expect(homeHost).toHaveTextContent(/^box\.example\.ts\.net:10000 \+1$/);
  });

  it('opens the machine detail on tap, and comes back', async () => {
    const store = fakeStore();
    render(Settings, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /^Mac/ }));
    expect(screen.getByRole('heading', { name: 'Mac' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove machine/i })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(store.back).not.toHaveBeenCalled();
  });

  it('toggles a machine from its row', async () => {
    const store = fakeStore({ statuses: { mac: 'online' } });
    render(Settings, { props: { store: store as never } });
    const sw = screen.getByRole('switch', { name: /connect mac/i });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(sw);
    expect(store.toggleMachine).toHaveBeenCalledWith('mac');
  });

  it('gives each machine a grip that reorders it, keeping its switch', async () => {
    const store = fakeStore({
      machines: [
        { id: 'a', name: 'Alpha', addresses: ['wss://a'], agentKey: KEY },
        { id: 'b', name: 'Beta', addresses: ['wss://b'], agentKey: KEY },
      ],
    });
    render(Settings, { props: { store: store as never } });
    expect(screen.getAllByRole('switch', { name: /^Connect/ })).toHaveLength(2);
    await fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Alpha' }), { key: 'ArrowDown' });
    expect(store.moveMachine).toHaveBeenCalledWith('a', 1);
    await fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Beta' }), { key: 'ArrowDown' });
    expect(store.moveMachine).toHaveBeenCalledTimes(1);
  });

  it('offers no grip with a single machine', () => {
    render(Settings, { props: { store: fakeStore() as never } });
    expect(screen.queryByRole('button', { name: 'Reorder Mac' })).toBeNull();
  });

  it('shows a switched-off machine as Off, with no error', () => {
    const store = fakeStore({
      machines: [{ id: 'mac', name: 'Mac', addresses: ['wss://mac'], agentKey: KEY, enabled: false }],
      statuses: { mac: 'offline' },
      lastConnectionError: { mac: { message: 'old error', code: 1006, at: Date.now() } },
    });
    render(Settings, { props: { store: store as never } });
    expect(screen.getByRole('button', { name: /^Mac/ })).toHaveTextContent('Off');
    expect(screen.queryByTestId('diagnostic')).toBeNull();
    expect(screen.getByRole('switch', { name: /connect mac/i }).getAttribute('aria-checked')).toBe('false');
  });

  it('shows why an offline machine is not connected', () => {
    const store = fakeStore({
      statuses: { mac: 'offline' },
      lastConnectionError: { mac: { message: 'machine unreachable', code: 1006, at: Date.now() } },
    });
    render(Settings, { props: { store: store as never } });
    expect(screen.getByTestId('diagnostic')).toHaveTextContent('machine unreachable (code 1006)');
  });

  it('hides an old error once the machine is online', () => {
    const store = fakeStore({
      statuses: { mac: 'online' },
      lastConnectionError: { mac: { message: 'old error', code: 1006, at: Date.now() } },
    });
    render(Settings, { props: { store: store as never } });
    expect(screen.queryByTestId('diagnostic')).toBeNull();
  });

});

describe('Settings — adding a machine', () => {
  it('keeps the pairing options folded away behind Add machine once a machine exists', async () => {
    const store = fakeStore();
    render(Settings, { props: { store: store as never } });
    expect(screen.queryByTestId('pair-machine')).toBeNull();
    const add = screen.getByRole('button', { name: 'Add machine' });
    expect(add.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(add);
    expect(screen.getByTestId('pair-machine')).toBeInTheDocument();
    // A phone joins a machine only through a `tarfa pair` link: there is no form to fill by hand.
    expect(screen.queryByRole('button', { name: /enter details by hand/i })).toBeNull();
  });

  it('shows the pairing options straight away when there is no machine yet', () => {
    render(Settings, { props: { store: fakeStore({ machines: [] }) as never } });
    expect(screen.getByTestId('pair-machine')).toBeInTheDocument();
  });
});

describe('Settings — dictation', () => {
  it('has no key field of its own: keys live on each machine', () => {
    render(Settings, { props: { store: fakeStore() as never } });
    expect(screen.queryByLabelText(/api key/i)).toBeNull();
    expect(screen.getByText(/API keys are stored on each machine/)).toBeInTheDocument();
  });

  it('names the machines that hold each key', () => {
    const store = fakeStore({ dictationKeySources: vi.fn((p: string) => (p === 'elevenlabs' ? ['Mac', 'Box'] : [])) });
    render(Settings, { props: { store: store as never } });
    expect(screen.getByTestId('elevenlabs-key-source')).toHaveTextContent('ElevenLabs: set on Mac, Box.');
    expect(screen.queryByTestId('openrouter-key-source')).toBeNull();
  });

  it("opens the machine's page at the key a setup explanation pointed to, once", async () => {
    const scrolled = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled(this.querySelector('input')?.id);
    };
    try {
      const store = fakeStore({ dictationKeyFocus: { machineId: 'mac', provider: 'openrouter' }, statuses: { mac: 'online' } });
      render(Settings, { props: { store: store as never } });
      expect(screen.getByRole('heading', { name: 'Mac' })).toBeInTheDocument();
      expect(scrolled).toHaveBeenCalledWith('machine-key-openrouter');
      expect(document.activeElement?.id).toBe('machine-key-openrouter');
      expect(store.dictationKeyFocus).toBeNull();
      await fireEvent.click(screen.getByRole('button', { name: /back/i }));
      await fireEvent.click(screen.getByRole('button', { name: /^Mac/ }));
      expect(screen.getByRole('heading', { name: 'Mac' })).toBeInTheDocument();
      expect(scrolled).toHaveBeenCalledTimes(1);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('lists the dictation presets', () => {
    render(Settings, { props: { store: fakeStore() as never } });
    expect(screen.getByRole('button', { name: /Edit Clean up/ })).toBeInTheDocument();
  });
});

describe('Settings — device key and diagnostics', () => {
  it('shows this device key fingerprint and where it is kept, to match against tarfa devices', () => {
    const store = fakeStore({ deviceKey: { fingerprint: 'a1b2-c3d4-e5f6', storage: { x25519: 'webcrypto', ed25519: 'noble' } } });
    render(Settings, { props: { store: store as never } });
    expect(screen.getByTestId('device-key')).toHaveTextContent(
      'Device key a1b2-c3d4-e5f6 · X25519 in WebCrypto (non-extractable) · Ed25519 stored key',
    );
  });

  it('says why a key is a stored key when WebCrypto was tried and failed', () => {
    const store = fakeStore({
      deviceKey: {
        fingerprint: 'a1b2-c3d4-e5f6',
        storage: { x25519: 'noble', ed25519: 'noble' },
        fallback: { x25519: 'WebCrypto key could not be stored: DataCloneError: no', ed25519: 'WebCrypto key could not be stored: DataCloneError: no' },
      },
    });
    render(Settings, { props: { store: store as never } });
    expect(screen.getByTestId('device-key')).toHaveTextContent(
      'X25519 stored key (WebCrypto key could not be stored: DataCloneError: no) · Ed25519 stored key (WebCrypto key could not be stored: DataCloneError: no)',
    );
  });

  it('puts a device key problem at the top, with its way out', async () => {
    const store = fakeStore({ deviceKey: null, deviceKeyError: 'IndexedDB unavailable: UnknownError: gone', deviceKeyUnreadable: true });
    render(Settings, { props: { store: store as never } });
    expect(screen.getByTestId('device-key')).toHaveTextContent('Device key unavailable: IndexedDB unavailable: UnknownError: gone');
    await fireEvent.click(screen.getByRole('button', { name: 'Make a new device key' }));
    expect(store.replaceDeviceKey).toHaveBeenCalled();
  });

  it('shows a live viewport readout under diagnostics', () => {
    render(Settings, { props: { store: fakeStore() as never } });
    expect(screen.getByTestId('viewport')).toHaveTextContent(/Viewport:\s*\d+\s*×\s*\d+\s*·\s*DPR/);
  });

  it('shows the terminal input log and reflects it on Refresh', async () => {
    inputLog.clear();
    inputLog.push({ kind: 'compositionupdate', detail: 'gi', out: 'i' });
    render(Settings, { props: { store: fakeStore() as never } });
    await fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    const panel = screen.getByTestId('input-log');
    expect(panel.textContent).toContain('compositionupdate');
    expect(panel.textContent).toContain('gi');
  });

  it('clears the terminal input log', async () => {
    inputLog.clear();
    inputLog.push({ kind: 'keydown', detail: 'a (65)', out: '' });
    render(Settings, { props: { store: fakeStore() as never } });
    await fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(inputLog.snapshot()).toEqual([]);
    expect(screen.getByTestId('input-log').textContent).toContain('Android IME events only');
  });
});

describe('Settings — workspace list', () => {
  it('turns grouping by project on', async () => {
    const store = fakeStore();
    render(Settings, { props: { store: store as never } });
    const toggle = screen.getByRole('switch', { name: /group by project/i });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await fireEvent.click(toggle);
    expect(store.setGroupByProject).toHaveBeenCalledWith(true);
  });
});

describe('Settings — terminal links', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('on Android, offers opening terminal links with the share sheet', async () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (Linux; Android 16) Chrome/155', share: vi.fn() });
    const store = fakeStore();
    render(Settings, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('switch', { name: /share sheet/i }));
    expect(store.setShareLinks).toHaveBeenCalledWith(true);
  });

  it('elsewhere, does not offer it', () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', share: vi.fn() });
    render(Settings, { props: { store: fakeStore() as never } });
    expect(screen.queryByRole('switch', { name: /share sheet/i })).toBeNull();
  });
});

describe('Settings — language', () => {
  afterEach(() => setLanguage('en'));

  it('offers Auto, English and French, and saves the pick', async () => {
    const store = fakeStore();
    render(Settings, { props: { store: store as never } });
    const select = screen.getByLabelText('Language') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['auto', 'en', 'fr']);
    await fireEvent.change(select, { target: { value: 'fr' } });
    expect(store.setLanguageChoice).toHaveBeenCalledWith('fr');
  });

  it('redraws in French at once when the language changes', async () => {
    render(Settings, { props: { store: fakeStore() as never } });
    expect(screen.getByLabelText('Language')).toBeTruthy();
    setLanguage('fr');
    await tick();
    expect(screen.getByLabelText('Langue')).toBeTruthy();
  });
});

describe('Settings in French', () => {
  afterEach(() => setLanguage('en'));

  it('titles the page in French', () => {
    setLanguage('fr');
    render(Settings, { props: { store: fakeStore() as never } });
    expect(screen.getByRole('heading', { name: 'Réglages' })).toBeTruthy();
  });
});
