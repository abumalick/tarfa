import { describe, it, expect } from 'vitest';
import { DEFAULT_PRESETS, type DictationPreset } from './dictation-presets';
import { setupOptions } from './dictation-setup';

const none = { elevenlabs: false, openrouter: false } as const;

describe('setupOptions', () => {
  it('offers Claude voice and both keys for the default presets, in preset order', () => {
    expect(setupOptions(DEFAULT_PRESETS, { ...none, claude: 'unavailable' })).toEqual([
      { kind: 'claude', state: 'setup' },
      { kind: 'key', provider: 'elevenlabs' },
      { kind: 'key', provider: 'openrouter' },
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
    expect(setupOptions(onlyOpenRouter, { ...none, claude: 'unavailable' })).toEqual([{ kind: 'key', provider: 'openrouter' }]);
  });

  it('leaves out a provider whose key is already there', () => {
    expect(setupOptions(DEFAULT_PRESETS, { elevenlabs: true, openrouter: false, claude: 'unavailable' })).toEqual([
      { kind: 'claude', state: 'setup' },
      { kind: 'key', provider: 'openrouter' },
    ]);
  });

  it('offers storing a key on the machine first when its agent takes one, for the providers still keyless', () => {
    expect(setupOptions(DEFAULT_PRESETS, { elevenlabs: true, openrouter: false, claude: 'unavailable' }, true)).toEqual([
      { kind: 'machine', providers: ['openrouter'] },
      { kind: 'claude', state: 'setup' },
      { kind: 'key', provider: 'openrouter' },
    ]);
  });

  it('does not offer the machine when its agent cannot hand keys out, or no key is missing', () => {
    expect(setupOptions(DEFAULT_PRESETS, { ...none, claude: 'unavailable' }, false).map((o) => o.kind)).not.toContain('machine');
    const onlyClaude: DictationPreset[] = [{ id: 'cv', name: 'CV', badge: 'CV', provider: 'claude' }];
    expect(setupOptions(onlyClaude, { ...none, claude: 'unavailable' }, true)).toEqual([{ kind: 'claude', state: 'setup' }]);
  });
});
