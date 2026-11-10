import { describe, expect, it } from 'vitest';
import { dictationKey, dictationKeySources } from './dictation-key-source';

const fromAgents = { mac: { elevenlabs: 'test-key-mac' }, box: { openrouter: 'test-key-box' } };

describe('dictationKey', () => {
  it('uses a key typed on this device first, wherever the workspace is', () => {
    expect(dictationKey('elevenlabs', ' typed-key ', 'box', fromAgents)).toBe('typed-key');
  });

  it("otherwise uses the key the attached workspace's machine provides", () => {
    expect(dictationKey('elevenlabs', '', 'mac', fromAgents)).toBe('test-key-mac');
    expect(dictationKey('openrouter', '', 'box', fromAgents)).toBe('test-key-box');
  });

  it("never borrows another machine's key: its operator would pay for this one's dictation", () => {
    expect(dictationKey('elevenlabs', '', 'box', fromAgents)).toBeNull();
  });

  it('has no agent key with no workspace open', () => {
    expect(dictationKey('elevenlabs', '', null, fromAgents)).toBeNull();
  });
});

describe('dictationKeySources', () => {
  it('names the machines providing a key, in list order', () => {
    const machines = [
      { id: 'box', name: 'Box' },
      { id: 'mac', name: 'Mac' },
      { id: 'other', name: 'Other' },
    ];
    const both = { ...fromAgents, other: { elevenlabs: 'test-key-other' } };
    expect(dictationKeySources('elevenlabs', machines, both)).toEqual(['Mac', 'Other']);
    expect(dictationKeySources('openrouter', machines, both)).toEqual(['Box']);
  });
});
