import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { serviceInstall } from './service-install';

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function dirs() {
  const templates = await mkdtemp(join(tmpdir(), 'tarfa-svc-templates-'));
  const home = await mkdtemp(join(tmpdir(), 'tarfa-svc-home-'));
  created.push(templates, home);
  await writeFile(join(templates, 'tarfa-agent.service'), 'unit AGENT_COMMAND\n');
  await writeFile(join(templates, 'app.tarfa.agent.plist'), 'plist AGENT_COMMAND\n');
  return { templates, home };
}

// A fake launchctl: a label booted out stays loaded for `lingers` more prints, and bootstrap fails
// its first `failures` tries, as launchd does while it still holds the label.
function launchctl(ran: string[], { lingers = 0, failures = 0 }: { lingers?: number; failures?: number } = {}) {
  let loaded = false;
  let prints = 0;
  let bootstraps = 0;
  return async (c: string, a: string[]) => {
    ran.push([c, ...a].join(' '));
    if (a[0] === 'bootout') {
      if (!loaded && lingers === 0) throw new Error('not loaded');
      loaded = true;
      prints = lingers;
      return '';
    }
    if (a[0] === 'print') {
      if (loaded && prints-- > 0) return 'state = running\n';
      loaded = false;
      throw new Error('could not find service');
    }
    if (a[0] === 'bootstrap' && bootstraps++ < failures) throw new Error('launchctl bootstrap failed: Bootstrap failed: 5: Input/output error');
    return '';
  };
}

describe('serviceInstall', () => {
  it('reads the templates the package ships by default', async () => {
    const home = await mkdtemp(join(tmpdir(), 'tarfa-svc-home-'));
    const unit = serviceInstall({ home, user: 'u', uid: 1000, platform: 'linux', run: async () => '' });
    expect(await unit.template()).toContain('KillMode=process');
    const agent = serviceInstall({ home, user: 'u', uid: 501, platform: 'darwin', run: async () => '' });
    expect(await agent.template()).toContain('app.tarfa.agent');
  });

  it('installs a systemd user unit, enables it and turns linger on', async () => {
    const { templates, home } = await dirs();
    const ran: string[] = [];
    const service = serviceInstall({ templates, home, user: 'u', uid: 1000, platform: 'linux', run: async (c, a) => (ran.push([c, ...a].join(' ')), a.includes('Linger') ? 'yes\n' : '') });
    expect(service.kind).toBe('systemd');
    expect(await service.template()).toBe('unit AGENT_COMMAND\n');
    expect(await service.installed()).toBeNull();
    await service.install('unit /r\n');
    expect(await readFile(join(home, '.config', 'systemd', 'user', 'tarfa-agent.service'), 'utf8')).toBe('unit /r\n');
    expect(await service.installed()).toBe('unit /r\n');
    expect(ran).toEqual(['systemctl --user daemon-reload', 'systemctl --user enable tarfa-agent', 'loginctl enable-linger u']);
    expect(await service.enabled()).toBe(true);
  });

  it('finds, stops and removes the unit installed under its old name', async () => {
    const { templates, home } = await dirs();
    const ran: string[] = [];
    const service = serviceInstall({ templates, home, user: 'u', uid: 1000, platform: 'linux', run: async (c, a) => (ran.push([c, ...a].join(' ')), '') });
    expect(await service.legacyInstalled()).toBe(false);
    const old = join(home, '.config', 'systemd', 'user', 'perch-agent.service');
    await mkdir(dirname(old), { recursive: true });
    await writeFile(old, 'old unit\n');
    await mkdir(`${old}.d`);
    await writeFile(join(`${old}.d`, '50-protect.conf'), '[Service]\nOOMScoreAdjust=-500\n');
    expect(await service.legacyInstalled()).toBe(true);
    await service.install('unit /r\n');
    expect(await readFile(join(home, '.config', 'systemd', 'user', 'tarfa-agent.service.d', '50-protect.conf'), 'utf8')).toBe('[Service]\nOOMScoreAdjust=-500\n');
    ran.length = 0;
    await service.stopLegacy();
    expect(ran).toEqual(['systemctl --user stop perch-agent', 'systemctl --user disable perch-agent']);
    await service.removeLegacy();
    expect(await service.legacyInstalled()).toBe(false);
    await expect(stat(`${old}.d`)).rejects.toThrow();
    expect(ran.at(-1)).toBe('systemctl --user daemon-reload');
  });

  it('boots out and removes the launchd agent installed under its old label', async () => {
    const { templates, home } = await dirs();
    const ran: string[] = [];
    const service = serviceInstall({ templates, home, user: 'u', uid: 501, platform: 'darwin', sleep: async () => undefined, run: launchctl(ran) });
    const old = join(home, 'Library', 'LaunchAgents', 'com.perch.agent.plist');
    await mkdir(dirname(old), { recursive: true });
    await writeFile(old, '<plist/>\n');
    expect(await service.legacyInstalled()).toBe(true);
    await service.stopLegacy();
    expect(ran).toEqual(['launchctl bootout gui/501/com.perch.agent', 'launchctl print gui/501/com.perch.agent']);
    await service.removeLegacy();
    expect(await service.legacyInstalled()).toBe(false);
  });

  it('is not enabled without linger, or when systemctl says it is not enabled', async () => {
    const { templates, home } = await dirs();
    const noLinger = serviceInstall({ templates, home, user: 'u', uid: 1000, platform: 'linux', run: async (_c, a) => (a.includes('Linger') ? 'no\n' : '') });
    expect(await noLinger.enabled()).toBe(false);
    const disabled = serviceInstall({
      templates,
      home,
      user: 'u',
      uid: 1000,
      platform: 'linux',
      run: async (_c, a) => {
        if (a.includes('is-enabled')) throw new Error('disabled');
        return 'yes\n';
      },
    });
    expect(await disabled.enabled()).toBe(false);
  });

  it('stops when systemctl --user cannot reach the user manager, instead of reading it as not enabled', async () => {
    const { templates, home } = await dirs();
    const run = (stderr: string) => async (_c: string, a: string[]) => {
      if (a.includes('is-enabled')) throw new Error(`systemctl --user is-enabled tarfa-agent failed: ${stderr}`);
      return 'yes\n';
    };
    const unreachable = serviceInstall({ templates, home, user: 'u', uid: 1000, platform: 'linux', run: run('Failed to connect to bus: No medium found') });
    await expect(unreachable.enabled()).rejects.toThrow(/XDG_RUNTIME_DIR=\/run\/user\/\$\(id -u\)/);
    const notFound = serviceInstall({ templates, home, user: 'u', uid: 1000, platform: 'linux', run: run('not-found') });
    expect(await notFound.enabled()).toBe(false);
  });

  it('installs a launchd agent, replacing a loaded one', async () => {
    const { templates, home } = await dirs();
    const ran: string[] = [];
    const service = serviceInstall({ templates, home, user: 'u', uid: 501, platform: 'darwin', sleep: async () => undefined, run: launchctl(ran) });
    expect(service.kind).toBe('launchd');
    await service.install('plist /r\n');
    const plist = join(home, 'Library', 'LaunchAgents', 'app.tarfa.agent.plist');
    expect(await readFile(plist, 'utf8')).toBe('plist /r\n');
    expect(ran).toEqual(['launchctl bootout gui/501/app.tarfa.agent', 'launchctl print gui/501/app.tarfa.agent', `launchctl bootstrap gui/501 ${plist}`]);
  });

  it('waits for launchd to let go of the label before bootstrapping it again', async () => {
    const { templates, home } = await dirs();
    const ran: string[] = [];
    const slept: number[] = [];
    const run = launchctl(ran, { lingers: 3 });
    const service = serviceInstall({ templates, home, user: 'u', uid: 501, platform: 'darwin', sleep: async (ms) => void slept.push(ms), run });
    await service.install('plist /r\n');
    expect(ran.filter((line) => line.includes('print'))).toHaveLength(4);
    expect(ran.at(-1)).toMatch(/^launchctl bootstrap gui\/501 /);
    expect(slept).toEqual([250, 250, 250]);
  });

  it('retries a bootstrap launchd refuses, and reports it ran', async () => {
    const { templates, home } = await dirs();
    const ran: string[] = [];
    const service = serviceInstall({ templates, home, user: 'u', uid: 501, platform: 'darwin', sleep: async () => undefined, run: launchctl(ran, { failures: 2 }) });
    expect((await service.install('plist /r\n')).at(-1)).toBe('launchctl bootstrap gui/501 (try 3)');
    expect(ran.filter((line) => line.includes('bootstrap'))).toHaveLength(3);
  });

  it('gives up after a bounded number of tries, naming the command that loads the plist on disk', async () => {
    const { templates, home } = await dirs();
    const ran: string[] = [];
    const service = serviceInstall({ templates, home, user: 'u', uid: 501, platform: 'darwin', sleep: async () => undefined, run: launchctl(ran, { failures: 99 }) });
    const plist = join(home, 'Library', 'LaunchAgents', 'app.tarfa.agent.plist');
    await expect(service.install('plist /r\n')).rejects.toThrow(`no agent is loaded: launchctl bootstrap failed: Bootstrap failed: 5: Input/output error (5 tries). The new ${plist} is in place: load it with \`launchctl bootstrap gui/501 ${plist}\``);
    expect(ran.filter((line) => line.includes('bootstrap'))).toHaveLength(5);
    expect(await readFile(plist, 'utf8')).toBe('plist /r\n');
  });

  it('says the old agent still runs when launchd never let go of its label', async () => {
    const { templates, home } = await dirs();
    const service = serviceInstall({ templates, home, user: 'u', uid: 501, platform: 'darwin', sleep: async () => undefined, run: launchctl([], { lingers: 1_000, failures: 99 }) });
    await expect(service.install('plist /r\n')).rejects.toThrow(/the agent already loaded keeps running its old definition: .*run `launchctl bootout gui\/501\/app\.tarfa\.agent`/);
  });

  it('stops waiting for a label that never goes, and lets the bootstrap report', async () => {
    const { templates, home } = await dirs();
    const ran: string[] = [];
    const service = serviceInstall({ templates, home, user: 'u', uid: 501, platform: 'darwin', sleep: async () => undefined, run: launchctl(ran, { lingers: 1_000 }) });
    await service.install('plist /r\n');
    expect(ran.filter((line) => line.includes('print'))).toHaveLength(40);
  });

  it('keeps a copy of the installed unit or plist beside it, and reads the legacy one', async () => {
    const { templates, home } = await dirs();
    const run = async () => '';
    for (const [platform, file] of [['linux', join(home, '.config', 'systemd', 'user', 'tarfa-agent.service')], ['darwin', join(home, 'Library', 'LaunchAgents', 'app.tarfa.agent.plist')]] as const) {
      const service = serviceInstall({ templates, home, user: 'u', uid: 1000, platform, run });
      expect(await service.backup()).toBeNull();
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, 'old text\n');
      const copy = await service.backup();
      expect(copy).toMatch(new RegExp(`${file.replace(/[.]/g, '\\.')}\\.bak-`));
      expect(await readFile(copy!, 'utf8')).toBe('old text\n');
      expect(await readFile(file, 'utf8')).toBe('old text\n');
    }
    const unit = join(home, '.config', 'systemd', 'user', 'tarfa-agent.service');
    await chmod(unit, 0o600);
    expect((await stat((await serviceInstall({ templates, home, user: 'u', uid: 1000, platform: 'linux', run }).backup())!)).mode & 0o777).toBe(0o600);
    const legacy = join(home, '.config', 'systemd', 'user', 'perch-agent.service');
    const linux = serviceInstall({ templates, home, user: 'u', uid: 1000, platform: 'linux', run });
    expect(await linux.legacyText()).toBeNull();
    await writeFile(legacy, 'legacy text\n');
    expect(await linux.legacyText()).toBe('legacy text\n');
  });
});
