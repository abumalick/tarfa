import { describe, expect, it } from 'vitest';
import { compareSemver, isSemver } from './semver';
import { runUpdate, type UpdateEffects } from './update-agent';

function fakes(over: Partial<UpdateEffects> = {}) {
  const calls: string[] = [];
  const effects: UpdateEffects = {
    installKind: () => 'package',
    currentVersion: () => '0.1.0',
    findMise: () => '/home/u/.local/bin/mise',
    latest: async () => (calls.push('registry'), '0.2.0'),
    install: async (_mise, version) => void calls.push(`install ${version}`),
    locate: async (_mise, version) => (calls.push(`locate ${version}`), { node: '/n', cli: '/c/bin/tarfa' }),
    apply: async (node, cli) => (calls.push(`apply ${node} ${cli}`), 0),
    log: (line) => void calls.push(`log ${line}`),
    ...over,
  };
  return { effects, calls };
}

describe('runUpdate', () => {
  it('refuses from a source install, before any network, mise or install', async () => {
    const { effects, calls } = fakes({ installKind: () => 'clone' });
    expect(await runUpdate(effects, { force: false })).toEqual({ exitCode: 2, message: 'this is a source install; git pull' });
    expect(calls).toEqual([]);
  });

  it('installs the registry\'s newest, then applies the new version, keeping its exit code', async () => {
    const { effects, calls } = fakes();
    expect(await runUpdate(effects, { force: false })).toEqual({ exitCode: 0, message: 'updated 0.1.0 to 0.2.0' });
    expect(calls.filter((c) => !c.startsWith('log'))).toEqual(['registry', 'install 0.2.0', 'locate 0.2.0', 'apply /n /c/bin/tarfa']);
    const failing = fakes({ apply: async () => 3 });
    expect(await runUpdate(failing.effects, { force: false })).toMatchObject({ exitCode: 3, message: expect.stringContaining('exited 3') });
  });

  it('says so and does nothing when already on the newest, unless --force', async () => {
    const { effects, calls } = fakes({ currentVersion: () => '0.2.0' });
    expect(await runUpdate(effects, { force: false })).toEqual({ exitCode: 0, message: expect.stringContaining('already on 0.2.0') });
    expect(calls).toEqual(['registry']);
    const forced = fakes({ currentVersion: () => '0.2.0' });
    expect((await runUpdate(forced.effects, { force: true })).message).toBe('updated 0.2.0 to 0.2.0');
    expect(forced.calls).toContain('install 0.2.0');
  });

  it('allows an older --version as a rollback, in one line, without asking the registry', async () => {
    const { effects, calls } = fakes({ currentVersion: () => '0.3.0' });
    expect((await runUpdate(effects, { version: '0.2.0', force: false })).exitCode).toBe(0);
    expect(calls).not.toContain('registry');
    expect(calls).toContain('log installing 0.2.0, older than 0.3.0 (a rollback)');
  });

  it('rejects anything but a release number before it reaches a command line', async () => {
    for (const bad of ['latest', '1.2', '--force', '1.2.3; rm -rf ~', '$(id)', '01.2.3', '']) {
      const { effects, calls } = fakes();
      expect(await runUpdate(effects, { version: bad, force: false })).toMatchObject({ exitCode: 2 });
      expect(calls).toEqual([]);
    }
  });

  it('names a registry failure in one line and changes nothing', async () => {
    const { effects, calls } = fakes({ latest: async () => { throw new Error('connect ECONNREFUSED'); } });
    const result = await runUpdate(effects, { force: false });
    expect(result).toEqual({ exitCode: 1, message: expect.stringContaining('ECONNREFUSED') });
    expect(result.message.split('\n')).toHaveLength(1);
    expect(calls).toEqual([]);
    const odd = fakes({ latest: async () => 'banana' });
    expect((await runUpdate(odd.effects, { force: false })).exitCode).toBe(1);
  });

  it('stops before apply when the install fails, saying the running version stays', async () => {
    const { effects, calls } = fakes({ install: async () => { throw new Error('mise: no such version'); } });
    const result = await runUpdate(effects, { force: false });
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain('0.1.0 stays installed');
    expect(calls.some((c) => c.startsWith('apply') || c.startsWith('locate'))).toBe(false);
  });

  it('refuses with no mise, before the registry', async () => {
    const { effects, calls } = fakes({ findMise: () => null });
    expect((await runUpdate(effects, { force: false })).message).toContain('needs mise');
    expect(calls).toEqual([]);
  });
});

describe('semver', () => {
  it('accepts releases and prereleases, nothing else', () => {
    for (const ok of ['0.1.0', '1.2.3', '1.0.0-rc.1', '1.0.0+build.5']) expect(isSemver(ok)).toBe(true);
    for (const bad of ['1', '1.2', 'v1.2.3', '1.2.3.4', '1.02.3', '1.2.3-', ' 1.2.3']) expect(isSemver(bad)).toBe(false);
  });

  it('orders by precedence', () => {
    expect(compareSemver('0.10.0', '0.9.0')).toBe(1);
    expect(compareSemver('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compareSemver('1.0.0-rc.2', '1.0.0-rc.10')).toBe(-1);
    expect(compareSemver('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
    expect(compareSemver('1.0.0+a', '1.0.0+b')).toBe(0);
  });
});
