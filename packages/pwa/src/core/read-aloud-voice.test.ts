import { describe, it, expect } from 'vitest';
import { DEFAULT_ELEVENLABS_VOICE, effectiveSource, elevenLabsVoice, parseReadAloudVoice } from './read-aloud-voice';

describe('parseReadAloudVoice', () => {
  it('defaults to the device voice', () => {
    expect(parseReadAloudVoice(null)).toEqual({ source: 'device', voice: null });
    expect(parseReadAloudVoice('not json')).toEqual({ source: 'device', voice: null });
    expect(parseReadAloudVoice('{"source":"other"}')).toEqual({ source: 'device', voice: null });
  });

  it('reads a stored ElevenLabs choice and voice', () => {
    expect(parseReadAloudVoice(JSON.stringify({ source: 'elevenlabs', voice: { id: 'v1', name: 'Ann' } }))).toEqual({
      source: 'elevenlabs',
      voice: { id: 'v1', name: 'Ann' },
    });
  });

  it('drops a malformed voice', () => {
    expect(parseReadAloudVoice(JSON.stringify({ source: 'elevenlabs', voice: { id: 3 } })).voice).toBeNull();
    expect(parseReadAloudVoice(JSON.stringify({ source: 'elevenlabs', voice: { id: '', name: 'x' } })).voice).toBeNull();
  });
});

describe('effectiveSource', () => {
  it('reads with ElevenLabs only when the machine holds a key', () => {
    expect(effectiveSource({ source: 'elevenlabs', voice: null }, true)).toBe('elevenlabs');
    expect(effectiveSource({ source: 'elevenlabs', voice: null }, false)).toBe('device');
    expect(effectiveSource({ source: 'device', voice: null }, true)).toBe('device');
  });
});

describe('elevenLabsVoice', () => {
  it('falls back to the default voice when none is chosen', () => {
    expect(elevenLabsVoice({ source: 'elevenlabs', voice: null })).toBe(DEFAULT_ELEVENLABS_VOICE);
    expect(elevenLabsVoice({ source: 'elevenlabs', voice: { id: 'v1', name: 'Ann' } })).toEqual({ id: 'v1', name: 'Ann' });
  });
});
