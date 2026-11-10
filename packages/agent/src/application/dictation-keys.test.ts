import { describe, expect, it } from 'vitest';
import { checkKey, parseDictationKeys, providerOf, withKey, withoutKey } from './dictation-keys';

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
