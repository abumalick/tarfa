import { describe, expect, it, vi } from 'vitest';
import type { DictationPreset } from './dictation-presets';
import { PresetRecorder } from './preset-recorder';

const recorder = () => ({ start: vi.fn(async () => undefined), stop: vi.fn(async () => new Blob(['x'])), discard: vi.fn() });

describe('PresetRecorder', () => {
  it('streams for a Claude voice preset and records a clip otherwise, stopping the one it started', async () => {
    const clip = recorder();
    const claude = recorder();
    let preset: DictationPreset = { id: 'cv', name: 'Claude voice', badge: 'CV', provider: 'claude' };
    const r = new PresetRecorder(() => preset, { clip, claude });
    await r.start();
    preset = { id: 'scribe', name: 'Scribe', badge: 'EL', provider: 'elevenlabs' };
    expect(r.startedWith?.id).toBe('cv');
    await r.stop();
    expect(r.startedWith?.id).toBe('cv');
    expect(claude.start).toHaveBeenCalled();
    expect(claude.stop).toHaveBeenCalled();
    expect(clip.stop).not.toHaveBeenCalled();
    await r.start();
    await r.stop();
    expect(clip.stop).toHaveBeenCalled();
  });

  it('discards with the recorder it started, and only once', async () => {
    const clip = recorder();
    const claude = recorder();
    const r = new PresetRecorder(() => ({ id: 'scribe', name: 'Scribe', badge: 'EL', provider: 'elevenlabs' }), { clip, claude });
    await r.start();
    r.discard();
    r.discard();
    expect(clip.discard).toHaveBeenCalledOnce();
    expect(clip.stop).not.toHaveBeenCalled();
    expect(claude.discard).not.toHaveBeenCalled();
  });

  it('refuses a stop with nothing recording', async () => {
    const r = new PresetRecorder(() => ({ id: 'cv', name: 'c', badge: 'C', provider: 'claude' }), { clip: recorder(), claude: recorder() });
    await expect(r.stop()).rejects.toThrow('not recording');
  });
});
