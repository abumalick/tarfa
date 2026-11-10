import { describe, it, expect } from 'vitest';
import { DEFAULT_PRESETS, type DictationPreset } from './dictation-presets';
import { setupOptions } from './dictation-setup';

const none = { elevenlabs: false, openrouter: false } as const;

describe('setupOptions', () => {
  it('offers Claude voice and both keys for the default presets, in preset order', () => {
    expect(setupOptions(DEFAULT_PRESETS, { ...none, claude: 'unavailable' })).toEqual([
      { kind: 'claude', state: 'setup' },
      { kind: 'key', provider: 'elevenlabs', route: 'update' },
      { kind: 'key', provider: 'openrouter', route: 'update' },
    ]);
  });

  it('gives the reason when the machine has Claude voice but this workspace cannot use it', () => {
    expect(setupOptions(DEFAULT_PRESETS, { ...none, claude: 'not-claude' })[0]).toEqual({ kind: 'claude', state: 'not-claude' });
    expect(setupOptions(DEFAULT_PRESETS, { ...none, claude: 'asking' })[0]).toEqual({ kind: 'claude', state: 'asking' });
  });

  it('suggests only what would unlock a preset in the list', () => {
    const onlyOpenRouter: DictationPreset[] = [
      { id: 'a', name: 'A', badge: 'A', provider: 'openrouter', model: 'm', prompt: 'p' },
      { id: 'b', name: 'B', badge: 'B', provider: 'openrouter', model: 'm', prompt: 'p' },
    ];
    expect(setupOptions(onlyOpenRouter, { ...none, claude: 'unavailable' })).toEqual([{ kind: 'key', provider: 'openrouter', route: 'update' }]);
  });

  it('leaves out a provider whose key is already there', () => {
    expect(setupOptions(DEFAULT_PRESETS, { elevenlabs: true, openrouter: false, claude: 'unavailable' })).toEqual([
      { kind: 'claude', state: 'setup' },
      { kind: 'key', provider: 'openrouter', route: 'update' },
    ]);
  });

  it('says how this machine takes each key', () => {
    expect(setupOptions(DEFAULT_PRESETS, { elevenlabs: true, openrouter: false, claude: 'unavailable' }, 'page')).toEqual([
      { kind: 'claude', state: 'setup' },
      { kind: 'key', provider: 'openrouter', route: 'page' },
    ]);
    expect(setupOptions(DEFAULT_PRESETS, { elevenlabs: true, openrouter: false, claude: 'unavailable' }, 'cli')[1]).toEqual({
      kind: 'key',
      provider: 'openrouter',
      route: 'cli',
    });
  });
});
