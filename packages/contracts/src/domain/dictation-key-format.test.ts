import { describe, expect, it } from 'vitest';
import { dictationKeyProblem } from './dictation-key-format';

// Low-entropy fixtures, so the leak check never takes them for real keys.
const elevenLabs = 'sk_' + 'a1'.repeat(24);
const legacyElevenLabs = '0123456789abcdef'.repeat(2);
const openRouter = 'sk-or-v1-' + 'b2'.repeat(32);

describe('dictationKeyProblem', () => {
  it.each([elevenLabs, legacyElevenLabs, 'sk_' + 'A9'.repeat(30)])('takes %s as an ElevenLabs key', (key) =>
    expect(dictationKeyProblem('elevenlabs', key)).toBeNull(),
  );

  it.each([openRouter, 'sk-or-v2-' + 'Z0'.repeat(40)])('takes %s as an OpenRouter key', (key) =>
    expect(dictationKeyProblem('openrouter', key)).toBeNull(),
  );

  it.each(['hello', 'sk_short', 'sk-' + 'a'.repeat(48), 'sk_' + 'a'.repeat(47) + '-', 'https://elevenlabs.io', 'sk-ant-' + 'a'.repeat(48)])(
    'refuses %s for ElevenLabs',
    (key) => expect(dictationKeyProblem('elevenlabs', key)).toBe('format'),
  );

  it.each(['hello', 'sk-or-' + 'b'.repeat(64), 'sk-or-v1-short', 'sk-proj-' + 'a'.repeat(64)])(
    'refuses %s for OpenRouter',
    (key) => expect(dictationKeyProblem('openrouter', key)).toBe('format'),
  );

  it('says when a key belongs to the other provider', () => {
    expect(dictationKeyProblem('elevenlabs', openRouter)).toBe('other-provider');
    expect(dictationKeyProblem('openrouter', elevenLabs)).toBe('other-provider');
    expect(dictationKeyProblem('openrouter', legacyElevenLabs)).toBe('other-provider');
  });
});
