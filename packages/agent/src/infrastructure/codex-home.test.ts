import { describe, expect, it } from 'vitest';
import { resolveCodexHome } from './codex-home';

function shell(out: string | Error) {
  const scripts: string[] = [];
  const run = async (script: string) => {
    scripts.push(script);
    if (out instanceof Error) throw out;
    return out;
  };
  return { run, scripts };
}

describe('resolveCodexHome', () => {
  it('takes CODEX_HOME from the environment without asking the shell', async () => {
    const { run, scripts } = shell('codex-home=/elsewhere\n');
    expect(await resolveCodexHome({ CODEX_HOME: '/srv/codex' }, '/home/u', run)).toBe('/srv/codex');
    expect(scripts).toEqual([]);
  });

  it('asks the login shell when the environment has none, as a service does', async () => {
    const { run } = shell('motd from a profile\ncodex-home=/home/u/.config/codex\n');
    expect(await resolveCodexHome({}, '/home/u', run)).toBe('/home/u/.config/codex');
  });

  it('reads an empty CODEX_HOME as unset, as Codex does', async () => {
    const { run, scripts } = shell('codex-home=\n');
    expect(await resolveCodexHome({ CODEX_HOME: '' }, '/home/u', run)).toBe('/home/u/.codex');
    expect(scripts).toHaveLength(1);
  });

  it('falls back to ~/.codex when the login shell fails', async () => {
    const { run } = shell(new Error('exit 1'));
    expect(await resolveCodexHome({}, '/home/u', run)).toBe('/home/u/.codex');
  });

  it('keeps a path with spaces whole', async () => {
    const { run } = shell('codex-home=/home/u/my codex\n');
    expect(await resolveCodexHome({}, '/home/u', run)).toBe('/home/u/my codex');
  });
});
