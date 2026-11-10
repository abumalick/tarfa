import { describe, expect, it } from 'vitest';
import { changeDictationKey, checkKey, parseDictationKeys, providerOf, withKey, withoutKey, type DictationKeys } from './dictation-keys';
import type { DictationKeysWriter } from '../ports/dictation-keys-port';

function fakeStore(initial: DictationKeys | { problem: string }): DictationKeysWriter & { keys: DictationKeys | null } {
  const box = { keys: 'problem' in initial ? null : (initial as DictationKeys) };
  return {
    get keys() {
      return box.keys;
    },
    async update(change) {
      if ('problem' in initial) return { problem: initial.problem as string };
      box.keys = change(box.keys ?? {});
      return { ok: true };
    },
  };
}

describe('parseDictationKeys', () => {
  it('reads both providers', () => {
    expect(parseDictationKeys('{"elevenlabs":"test-key-1","openrouter":"test-key-2"}')).toEqual({
      elevenlabs: 'test-key-1',
      openrouter: 'test-key-2',
    });
  });

  it('keeps only known providers holding a valid key', () => {
    expect(parseDictationKeys('{"elevenlabs":"test-key-1","openrouter":42,"other":"x"}')).toEqual({ elevenlabs: 'test-key-1' });
    expect(parseDictationKeys('{"elevenlabs":"has space"}')).toEqual({});
  });

  it('calls anything but an object malformed, never quoting the text', () => {
    for (const raw of ['not json test-key-1', '[]', 'null', '"test-key-1"']) {
      expect(parseDictationKeys(raw)).toBe('malformed');
    }
  });
});

describe('checkKey', () => {
  it('trims surrounding whitespace, a piped newline included', () => {
    expect(checkKey('  test-key-1\n')).toEqual({ ok: true, key: 'test-key-1' });
  });

  it('refuses an empty key, whitespace inside one, or a very long one, without echoing it', () => {
    for (const raw of ['', '   \n', 'test key', 'test-key\n2', 'k'.repeat(513)]) {
      const result = checkKey(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).not.toContain(raw.trim() || '\u0000');
    }
  });
});

describe('providerOf', () => {
  it('names the two providers and nothing else', () => {
    expect(providerOf('elevenlabs')).toBe('elevenlabs');
    expect(providerOf('openrouter')).toBe('openrouter');
    expect(providerOf('claude')).toBeNull();
  });
});

describe('withKey / withoutKey', () => {
  it('sets and removes one provider, leaving the other', () => {
    const both = withKey(withKey({}, 'elevenlabs', 'a'), 'openrouter', 'b');
    expect(both).toEqual({ elevenlabs: 'a', openrouter: 'b' });
    expect(withoutKey(both, 'elevenlabs')).toEqual({ openrouter: 'b' });
  });
});

describe('changeDictationKey', () => {
  it('stores a checked key beside the other provider\'s', async () => {
    const store = fakeStore({ elevenlabs: 'test-key-1' });
    expect(await changeDictationKey(store, 'openrouter', '  test-key-2\n')).toEqual({ ok: true });
    expect(store.keys).toEqual({ elevenlabs: 'test-key-1', openrouter: 'test-key-2' });
  });

  it('removes a key on null, and answers ok when there was none', async () => {
    const store = fakeStore({ elevenlabs: 'test-key-1' });
    expect(await changeDictationKey(store, 'elevenlabs', null)).toEqual({ ok: true });
    expect(await changeDictationKey(store, 'openrouter', null)).toEqual({ ok: true });
    expect(store.keys).toEqual({});
  });

  it('refuses a bad key without writing or echoing it', async () => {
    const store = fakeStore({ elevenlabs: 'test-key-1' });
    const result = await changeDictationKey(store, 'elevenlabs', 'bad key-secret');
    expect(result).toEqual({ ok: false, error: 'a key holds no whitespace' });
    expect(store.keys).toEqual({ elevenlabs: 'test-key-1' });
  });

  it('passes on the store\'s problem with the file', async () => {
    const store = fakeStore({ problem: '/x/dictation-keys.json is malformed' });
    expect(await changeDictationKey(store, 'elevenlabs', 'test-key-1')).toEqual({ ok: false, error: '/x/dictation-keys.json is malformed' });
  });
});
