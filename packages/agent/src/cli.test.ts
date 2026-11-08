import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, lstat, mkdtemp, mkdir, readFile, readlink, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deviceFingerprint, generateDeviceKeys, parsePairingLink } from '@tarfa/secure-channel';
import { FileDeviceStore } from './infrastructure/file-device-store';
import { TmuxAdapter } from './infrastructure/tmux-adapter';
import { parseEnvFile } from './application/agent-env';
import { enrolDevice, enrolmentMode, withEnrolmentMode } from './application/device-roster';
import { loadOrCreateAgentKeys } from './infrastructure/agent-key-file';
import type { Workspace } from '@tarfa/contracts';
import type { TmuxPort, TmuxSessionInfo } from './ports/tmux-port';
import { renderService } from './application/service-unit';
import { run, UsageError, type CliIo } from './cli';

const exec = promisify(execFile);
const sessions: string[] = [];
const tmpDirs: string[] = [];

afterEach(async () => {
  for (const name of sessions.splice(0)) {
    await exec('tmux', ['kill-session', '-t', name]).catch(() => undefined);
  }
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('tarfa CLI (real tmux)', () => {
  it('creates, lists, and closes a workspace end to end', async () => {
    const home = await mkdtemp(join(tmpdir(), 'tarfa-cli-home-'));
    const project = await mkdtemp(join(tmpdir(), 'tarfa-cli-proj-'));
    tmpDirs.push(home, project);
    const env = { TARFA_MACHINE_ID: 'test', TARFA_TOKEN: 'test-token', TARFA_PROJECT_ROOTS: tmpdir(), TARFA_AGENT_ENV: join(home, 'agent.env') };

    const createdJson = await run(['create', project, 'sleep 30'], env, home);
    const ws = JSON.parse(createdJson) as { id: string; projectPath: string; status: string };
    sessions.push(ws.id);
    expect(ws.id.startsWith('tarfa-cli-proj-')).toBe(true);
    expect(ws.projectPath).toBe(project);
    expect(ws.status).toBe('idle');

    const listJson = await run(['list'], env, home);
    const list = JSON.parse(listJson) as Array<{ id: string }>;
    expect(list.some((w) => w.id === ws.id)).toBe(true);

    const recentJson = await run(['recent'], env, home);
    expect(JSON.parse(recentJson)).toContain(project);

    await new TmuxAdapter().killSession(ws.id);
    const afterJson = await run(['list'], env, home);
    const after = JSON.parse(afterJson) as Array<{ id: string }>;
    expect(after.some((w) => w.id === ws.id)).toBe(false);
  });

  // `tarfa list` is the same question the PWA asks, so it must not answer it differently.
  it('stamps the agent address of the Claude session running in a workspace', async () => {
    const home = await mkdtemp(join(tmpdir(), 'tarfa-cli-home-'));
    const project = await mkdtemp(join(tmpdir(), 'tarfa-cli-proj-'));
    tmpDirs.push(home, project);
    const env = { TARFA_MACHINE_ID: 'test', TARFA_TOKEN: 'test-token', TARFA_PROJECT_ROOTS: tmpdir(), TARFA_AGENT_ENV: join(home, 'agent.env') };

    const ws = JSON.parse(await run(['create', project, 'sleep 30'], env, home)) as { id: string };
    sessions.push(ws.id);

    await mkdir(join(home, '.claude', 'sessions'), { recursive: true });
    await writeFile(
      join(home, '.claude', 'sessions', '4242.json'),
      JSON.stringify({ name: 'project-ab', tmux: `${ws.id}:@1.%1` }),
      'utf8',
    );

    const list = JSON.parse(await run(['list'], env, home)) as Array<{ id: string; agentAddress?: string }>;
    expect(list.find((w) => w.id === ws.id)?.agentAddress).toBe('project-ab');
  });
});

describe('tarfa --version', () => {
  it('prints the package version', async () => {
    const { version } = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')) as { version: string };
    expect(await run(['--version'], {}, '/nonexistent')).toBe(version);
    expect(await run(['-v'], {}, '/nonexistent')).toBe(version);
  });
});

describe('tarfa --help', () => {
  it('lists every command with no agent.env, for a bare tarfa, --help, -h and help', async () => {
    for (const argv of [[], ['--help'], ['-h'], ['help']]) {
      const help = await run(argv, {}, '/nonexistent');
      for (const command of ['setup', 'pair', 'update', 'apply', 'devices', 'install-hooks', 'serve', 'ls', 'spawn', 'peek', 'wait', 'send', 'unpark', 'rename', 'close']) {
        expect(help).toMatch(new RegExp(`^  ${command}\\b`, 'm'));
      }
    }
  });

  it('refuses serve with anything after it instead of starting a second agent', async () => {
    await expect(run(['serve', '--help'], {}, '/nonexistent')).rejects.toMatchObject({ exitCode: 2, message: expect.stringContaining('usage: tarfa serve') });
  });

  it('refuses an unknown command with exit 2 and a pointer to --help, before reading agent.env', async () => {
    await expect(run(['frobnicate'], {}, '/nonexistent')).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringContaining('unknown command: frobnicate (run `tarfa --help`)'),
    });
  });
});

describe('removed relay commands', () => {
  it('refuses connect, relay-key and pair --relay with one line naming what replaces them, exit 2', async () => {
    const home = await mkdtemp(join(tmpdir(), 'tarfa-cli-home-'));
    tmpDirs.push(home);
    // No agent.env at all: the refusal needs nothing from the machine.
    const env = { TARFA_AGENT_ENV: join(home, 'agent.env') };
    for (const argv of [['connect', 'wss://relay.example', '--key', 'k'], ['relay-key'], ['pair', '--relay', 'wss://relay.example']]) {
      const refused = run(argv, env, home);
      await expect(refused).rejects.toBeInstanceOf(UsageError);
      await expect(refused).rejects.toMatchObject({ exitCode: 2, message: expect.stringMatching(/^[^\n]*relays are gone[^\n]*tarfa setup[^\n]*tarfa pair[^\n]*$/) });
    }
  });
});

describe('tarfa install-hooks', () => {
  it('bakes in the port from the agent.env the service reads', async () => {
    const home = await mkdtemp(join(tmpdir(), 'tarfa-cli-home-'));
    tmpDirs.push(home);
    const envPath = join(home, 'agent.env');
    await writeFile(envPath, 'TARFA_MACHINE_ID=box\nTARFA_PORT=9911\n');
    await run(['install-hooks'], { TARFA_AGENT_ENV: envPath }, home);
    const settings = await readFile(join(home, '.claude', 'settings.json'), 'utf8');
    expect(settings).toContain('tarfa-hook.sh Stop 9911');
  });

  it('copies the kill guard beside the status hook and registers it on Bash', async () => {
    const home = await mkdtemp(join(tmpdir(), 'tarfa-cli-home-'));
    tmpDirs.push(home);
    const envPath = join(home, 'agent.env');
    await writeFile(envPath, 'TARFA_MACHINE_ID=box\nTARFA_PORT=9911\n');
    await mkdir(join(home, '.codex'));
    await run(['install-hooks'], { TARFA_AGENT_ENV: envPath }, home);
    expect(await readFile(join(home, '.tarfa', 'tarfa-guard.sh'), 'utf8')).toContain('pkill');
    for (const file of [join(home, '.claude', 'settings.json'), join(home, '.codex', 'hooks.json')]) {
      const { hooks } = JSON.parse(await readFile(file, 'utf8')) as {
        hooks: { PreToolUse: Array<{ matcher?: string; hooks: Array<{ command: string }> }> };
      };
      expect(hooks.PreToolUse).toContainEqual({
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'bash ~/.tarfa/tarfa-guard.sh' }],
      });
    }
  });

  it('registers Codex hooks only where Codex is installed', async () => {
    const home = await mkdtemp(join(tmpdir(), 'tarfa-cli-home-'));
    tmpDirs.push(home);
    const envPath = join(home, 'agent.env');
    await writeFile(envPath, 'TARFA_MACHINE_ID=box\nTARFA_PORT=9911\n');
    await run(['install-hooks'], { TARFA_AGENT_ENV: envPath }, home);
    await expect(readFile(join(home, '.codex', 'hooks.json'), 'utf8')).rejects.toThrow();

    await mkdir(join(home, '.codex'));
    const out = await run(['install-hooks'], { TARFA_AGENT_ENV: envPath }, home);
    expect(await readFile(join(home, '.codex', 'hooks.json'), 'utf8')).toContain('tarfa-hook.sh Stop 9911 codex');
    expect(out).toContain('/hooks');
  });
});

describe('tarfa devices', () => {
  async function withPhones() {
    const home = await mkdtemp(join(tmpdir(), 'tarfa-cli-home-'));
    tmpDirs.push(home);
    const env = { TARFA_MACHINE_ID: 'test', TARFA_AGENT_ENV: join(home, 'agent.env') };
    const store = new FileDeviceStore(join(home, '.tarfa', 'devices.json'));
    const at = new Date('2026-09-24T10:00:00Z');
    const phones = [generateDeviceKeys(), generateDeviceKeys()];
    await store.update((r) =>
      phones.reduce(
        (roster, k, i) => enrolDevice(roster, { x25519: k.x25519.publicKey, ed25519: k.ed25519.publicKey, name: `phone ${i}` }, at),
        r,
      ),
    );
    const ids = phones.map((k) => deviceFingerprint(k.x25519.publicKey));
    return { home, env, store, ids };
  }

  // A roster written before names were sanitised at the handshake may still hold a hostile one.
  it('prints a device name with its control characters replaced', async () => {
    const { home, env, store, ids } = await withPhones();
    await store.update((r) => ({ ...r, devices: r.devices.map((d, i) => (i === 0 ? { ...d, name: 'evil\u001b[2J\nname' } : d)) }));
    expect(await run(['devices'], env, home)).toContain(`${ids[0]}  evil?[2J?name  enrolled`);
  });

  it('lists enrolled devices with their fingerprint, name and date, and the enrolment setting', async () => {
    const { home, env, ids } = await withPhones();
    const out = await run(['devices'], env, home);
    expect(out).toContain('enrolment: on');
    expect(out).toContain(`${ids[0]}  phone 0  enrolled 2026-09-24`);
    expect(out).toContain(`${ids[1]}  phone 1  enrolled 2026-09-24`);
    // The full key names a device when two share an id.
    const roster = JSON.parse(await readFile(join(home, '.tarfa', 'devices.json'), 'utf8')) as { devices: Array<{ x25519: string }> };
    expect(out).toContain(`enrolled 2026-09-24  key ${roster.devices[0]!.x25519}`);
    expect(await run(['devices', 'list'], env, home)).toBe(out);
  });

  it('revokes a device by a prefix of its fingerprint, and forgets it', async () => {
    const { home, env, store, ids } = await withPhones();
    const revoked = await run(['devices', 'revoke', ids[0]!.slice(0, 4)], env, home);
    expect(revoked).toContain(`revoked ${ids[0]} (phone 0)`);
    expect(revoked).toContain('whoever holds the token can still enrol a new key');
    const roster = await store.read();
    expect(roster.devices.map((d) => d.id)).toEqual([ids[1]]);
    expect(roster.revoked.map((d) => d.id)).toEqual([ids[0]]);
    expect(await run(['devices'], env, home)).toContain(`${ids[0]}  phone 0  revoked`);
    expect(await run(['devices', 'forget', ids[0]!], env, home)).toContain(`forgot ${ids[0]}`);
    expect((await store.read()).revoked).toEqual([]);
  });

  it('refuses an unknown or ambiguous device id', async () => {
    const { home, env } = await withPhones();
    await expect(run(['devices', 'revoke', 'ffff-ffff-ffff'], env, home)).rejects.toThrow(/no single device/);
    await expect(run(['devices', 'revoke'], env, home)).rejects.toThrow(/usage/);
  });

  it('sets enrolment on, off (pairing codes only) or closed, and lists it', async () => {
    const { home, env, store } = await withPhones();
    expect(await run(['devices', 'enrolment', 'off'], env, home)).toContain('enrolment: off');
    expect(enrolmentMode(await store.read())).toBe('off');
    expect(await run(['devices'], env, home)).toContain('enrolment: off (only a pairing code from `tarfa pair` enrols a phone)');
    await run(['devices', 'enrolment', 'closed'], env, home);
    expect(enrolmentMode(await store.read())).toBe('closed');
    expect(await run(['devices'], env, home)).toContain('enrolment: closed (no new phone can enrol)');
    await run(['devices', 'enrolment', 'on'], env, home);
    expect(enrolmentMode(await store.read())).toBe('on');
    await expect(run(['devices', 'enrolment', 'maybe'], env, home)).rejects.toThrow(/usage/);
    await expect(run(['devices', 'enrolment'], env, home)).rejects.toThrow(/usage/);
  });

  it('warns after a revoke only while the token can still enrol a new key', async () => {
    const { home, env, ids } = await withPhones();
    await run(['devices', 'enrolment', 'off'], env, home);
    expect(await run(['devices', 'revoke', ids[0]!], env, home)).not.toContain('token');
  });
});

describe('tarfa pair (arguments and agent.env)', () => {
  async function machine(envText: string) {
    const home = await mkdtemp(join(tmpdir(), 'perch-pair-home-'));
    tmpDirs.push(home);
    const envPath = join(home, 'agent.env');
    await writeFile(envPath, envText);
    return { home, env: { TARFA_AGENT_ENV: envPath } };
  }
  const base = 'TARFA_MACHINE_ID=box\nTARFA_TOKEN=t\nTARFA_PHONE_ADDRESSES=wss://box.example.ts.net\n';

  it('mints a pairing link for the phone address, reading the agent.env the service reads', async () => {
    const { home, env } = await machine(`${base}TARFA_PWA_ORIGIN=https://pwa.example:8443\n`);
    const out = await run(['pair'], { ...env, TARFA_PHONE_ADDRESSES: 'wss://stale.example.ts.net' }, home);
    const link = out.split('\n').find((line) => line.startsWith('https://'))!;
    const pairing = parsePairingLink(link)!;
    expect(pairing.urls).toEqual(['wss://box.example.ts.net']);
    expect(pairing.name).toBe('box');
    const stored = JSON.parse(await readFile(join(home, '.tarfa', 'pairing.json'), 'utf8')) as Array<{ secret: string }>;
    expect(stored.map((p) => p.secret)).toEqual([pairing.secret]);
    expect(out).toContain('for 10 minutes');
    // The phone shows the same fingerprint before it pairs, to compare by eye.
    expect(out).toContain(`machine key ${deviceFingerprint(pairing.agentKey)};`);
  });

  it('takes --ttl in minutes, from 1 to 10, and stores the expiry it states', async () => {
    const { home, env } = await machine(base);
    const before = Date.now();
    const out = await run(['pair', '--ttl', '2'], env, home);
    expect(out).toContain('for 2 minutes');
    const [stored] = JSON.parse(await readFile(join(home, '.tarfa', 'pairing.json'), 'utf8')) as Array<{ expiresAt: string }>;
    const left = Date.parse(stored!.expiresAt) - before;
    expect(left).toBeGreaterThanOrEqual(2 * 60_000);
    expect(left).toBeLessThan(2 * 60_000 + 5_000);
    for (const bad of ['0', '11', '1.5', 'x']) await expect(run(['pair', '--ttl', bad], env, home)).rejects.toThrow(/--ttl/);
  });

  it('hands the phone the TARFA_DEFAULT_PATH agent.env sets', async () => {
    const { home, env } = await machine(`${base}TARFA_PWA_ORIGIN=https://pwa.example:8443\nTARFA_DEFAULT_PATH=/home/u/workspace\n`);
    const out = await run(['pair'], env, home);
    expect(parsePairingLink(out.split('\n').find((line) => line.startsWith('https://'))!)!.defaultPath).toBe('/home/u/workspace');
  });

  it('names the pairing after the host when the machine id is the generic "local"', async () => {
    const { home, env } = await machine('TARFA_MACHINE_ID=local\nTARFA_TOKEN=t\nTARFA_PHONE_ADDRESSES=wss://box.example.ts.net\nTARFA_PWA_ORIGIN=https://pwa.example:8443\n');
    const out = await run(['pair'], env, home);
    const pairing = parsePairingLink(out.split('\n').find((line) => line.startsWith('https://'))!)!;
    expect(pairing.name).toBe(hostname().split('.')[0]);
  });

  it('takes --pwa over TARFA_PWA_ORIGIN, and the tarfa.app default without either', async () => {
    const { home, env } = await machine(base);
    expect(await run(['pair'], env, home)).toContain('https://tarfa.app/#pair?');
    const out = await run(['pair', '--pwa', 'https://pwa.example/ignored/path'], env, home);
    expect(out).toContain('https://pwa.example/#pair?');
  });

  it('refuses a machine with no TARFA_PHONE_ADDRESSES, pointing at tarfa setup', async () => {
    const { home, env } = await machine('TARFA_MACHINE_ID=box\nTARFA_TOKEN=t\nTARFA_RELAY_URLS=wss://relay.example\n');
    await expect(run(['pair'], env, home)).rejects.toThrow(/TARFA_PHONE_ADDRESSES.*tarfa setup/);
  });

  it('mints a link with every TARFA_PHONE_ADDRESSES address, in order', async () => {
    const { home, env } = await machine(
      'TARFA_MACHINE_ID=dev\nTARFA_TOKEN=t\nTARFA_DEFAULT_PATH=/home/u/workspace\n' +
        'TARFA_PHONE_ADDRESSES=wss://dev.example.ts.net:10000/abu,wss://dev.example.ts.net:8443/abu\n',
    );
    const out = await run(['pair'], env, home);
    const link = out.split('\n').find((line) => line.startsWith('https://'))!;
    const { agentKey, secret } = parsePairingLink(link)!;
    expect(link).toBe(
      `https://tarfa.app/#pair?u=wss://dev.example.ts.net:10000/abu&u=wss://dev.example.ts.net:8443/abu&k=${agentKey}&s=${secret}&n=dev&p=/home/u/workspace`,
    );
  });

  it('refuses a TARFA_PHONE_ADDRESSES address a phone would refuse', async () => {
    const { home, env } = await machine('TARFA_MACHINE_ID=box\nTARFA_TOKEN=t\nTARFA_PHONE_ADDRESSES=ws://dev.example.ts.net/abu\n');
    await expect(run(['pair'], env, home)).rejects.toThrow(/TARFA_PHONE_ADDRESSES/);
  });
});

describe('tarfa setup (fake service and Tailscale)', () => {
  const HOST = 'dev.example.ts.net';
  async function machine(envText: string | null = null, opts: { legacy?: boolean; kind?: 'package' | 'clone' } = {}) {
    const kind = opts.kind ?? 'clone';
    let legacy = opts.legacy ?? false;
    let legacyUnit: string | null = null;
    const root = await mkdtemp(join(tmpdir(), 'tarfa-setup-'));
    tmpDirs.push(root);
    const repo = join(root, 'repo');
    const home = join(root, 'home');
    await mkdir(join(repo, 'deploy'), { recursive: true });
    await mkdir(home);
    await writeFile(join(repo, 'deploy', 'tarfa-agent.service'), '[Service]\nExecStart=AGENT_COMMAND\nKillMode=process\n');
    const envPath = kind === 'package' ? join(home, '.tarfa', 'agent.env') : join(repo, 'deploy', 'agent.env');
    if (envText !== null) {
      await mkdir(join(envPath, '..'), { recursive: true, mode: 0o700 });
      await writeFile(envPath, envText, { mode: 0o600 });
    }
    const calls: string[] = [];
    let unit: string | null = null;
    let served: Record<string, unknown> = {};
    const io: CliIo = {
      setup: {
        installKind: kind,
        service: {
          kind: 'systemd',
          template: () => readFile(join(repo, 'deploy', 'tarfa-agent.service'), 'utf8'),
          installed: async () => unit,
          enabled: async () => unit !== null,
          install: async (text) => {
            // The roster must be on disk before the service can first start.
            const roster = await readFile(join(home, '.tarfa', 'devices.json'), 'utf8').then(() => 'present', () => 'absent');
            const launcher = await readFile(join(home, '.tarfa', 'bin', 'tarfa-agent'), 'utf8').then(() => 'present', () => 'absent');
            calls.push(kind === 'package' ? `install-unit roster=${roster} launcher=${launcher}` : `install-unit roster=${roster}`);
            unit = text;
            return ['enabled'];
          },
          backup: async () => (calls.push('backup-unit'), unit === null ? null : '/unit.bak-1'),
          legacyInstalled: async () => legacy,
          legacyText: async () => legacyUnit,
          stopLegacy: async () => (calls.push('stop-legacy'), ['stopped']),
          removeLegacy: async () => (calls.push('remove-legacy'), (legacy = false), (legacyUnit = null), ['removed']),
        },
        tailscale: {
          status: async () => ({
            BackendState: 'Running',
            CurrentTailnet: { MagicDNSEnabled: true },
            CertDomains: [HOST],
            Self: { DNSName: `${HOST}.`, CapMap: { funnel: null, 'https://tailscale.com/cap/funnel-ports?ports=443,8443,10000': null } },
          }),
          serveStatus: async () => served,
          serve: async (entry) => {
            calls.push(`serve ${entry.port}${entry.path} ${entry.target} funnel=${entry.funnel}`);
            const hostPort = `${HOST}:${entry.port}`;
            served = { TCP: { [entry.port]: { HTTPS: true } }, Web: { [hostPort]: { Handlers: { [entry.path]: { Proxy: entry.target } } } }, AllowFunnel: { [hostPort]: entry.funnel } };
          },
        },
        portOwner: async () => 'free',
        restart: { restart: async () => (calls.push('restart'), 'restarted') },
        checkListener: async () => (calls.push('check'), true),
      },
    };
    return { repo, home, env: kind === 'package' ? {} : { TARFA_AGENT_ENV: envPath }, envPath, calls, io, unit: () => unit, setUnit: (text: string | null) => { unit = text; }, setLegacyUnit: (text: string) => { legacyUnit = text; legacy = true; } };
  }
  const FLAGS = ['--machine-id', 'dev', '--project-roots', '/home/u/workspace', '--tailscale', 'funnel', '--slug', 'abu'];

  it('sets a fresh machine up, then changes nothing when rerun', async () => {
    const m = await machine();
    const out = await run(['setup', ...FLAGS], m.env, m.home, m.io);
    expect(out).toContain('the phone port answers');
    expect(m.calls).toEqual(['install-unit roster=present', 'serve 10000/abu http://127.0.0.1:8797 funnel=true', 'restart', 'check']);
    const values = parseEnvFile(await readFile(m.envPath, 'utf8'));
    expect(values).toMatchObject({ TARFA_MACHINE_ID: 'dev', TARFA_PHONE_ADDRESSES: `wss://${HOST}:10000/abu`, TARFA_PWA_ORIGIN: 'https://tarfa.app' });
    expect(values.TARFA_TOKEN).toMatch(/^[0-9a-f]{64}$/);
    // What run-agent.sh does with it: bash reads back exactly what was written.
    const sourced = await promisify(execFile)('bash', ['-c', '. "$1"; printf %s "$TARFA_PHONE_ADDRESSES|$TARFA_PROJECT_ROOTS"', '_', m.envPath], { env: {} });
    expect(sourced.stdout).toBe(`wss://${HOST}:10000/abu|/home/u/workspace`);
    expect(enrolmentMode(await new FileDeviceStore(join(m.home, '.tarfa', 'devices.json')).read())).toBe('off');
    expect(JSON.parse(await readFile(join(m.home, '.tarfa', 'agent-key.json'), 'utf8'))).toHaveProperty('x25519');
    expect(await readFile(join(m.home, '.claude', 'settings.json'), 'utf8')).toContain('tarfa-hook.sh');

    m.calls.length = 0;
    const env = await readFile(m.envPath, 'utf8');
    expect(await run(['setup', ...FLAGS], m.env, m.home, m.io)).toMatch(/already set up/);
    expect(m.calls).toEqual(['check']);
    expect(await readFile(m.envPath, 'utf8')).toBe(env);
  });

  it('swaps a machine set up before the rename: old service stopped, ~/.perch moved, new one started, old one removed', async () => {
    const m = await machine('PERCH_TOKEN=keep-me\nPERCH_MACHINE_ID=dev\n', { legacy: true });
    const legacy = join(m.home, '.perch');
    await mkdir(legacy, { mode: 0o700 });
    const key = await loadOrCreateAgentKeys(join(legacy, 'relay-key.json'));
    await new FileDeviceStore(join(legacy, 'devices.json')).update((roster) => withEnrolmentMode(roster, 'off'));

    await run(['setup', ...FLAGS], m.env, m.home, m.io);
    expect(m.calls).toEqual(['stop-legacy', 'install-unit roster=present', 'restart', 'check', 'serve 10000/abu http://127.0.0.1:8797 funnel=true', 'remove-legacy']);
    expect(await readlink(legacy)).toBe('.tarfa');
    expect((await loadOrCreateAgentKeys(join(m.home, '.tarfa', 'agent-key.json'))).x25519.publicKey).toBe(key.x25519.publicKey);
    const env = await readFile(m.envPath, 'utf8');
    expect(env).toMatch(/^TARFA_TOKEN=keep-me\nTARFA_MACHINE_ID=dev\n/);
    expect(env).not.toContain('PERCH_');

    m.calls.length = 0;
    expect(await run(['setup', ...FLAGS], m.env, m.home, m.io)).toMatch(/already set up/);
    expect(m.calls).toEqual(['check']);
  });

  it('prints a pairing link with --pair', async () => {
    const m = await machine();
    const out = await run(['setup', ...FLAGS, '--pair'], m.env, m.home, m.io);
    const link = out.split('\n').find((line) => line.startsWith('https://tarfa.app/#pair?'))!;
    expect(parsePairingLink(link)!.urls).toEqual([`wss://${HOST}:10000/abu`]);
  });

  it('changes nothing on a dry run', async () => {
    const m = await machine('TARFA_TOKEN=keep\n');
    const out = await run(['setup', ...FLAGS, '--dry-run'], m.env, m.home, m.io);
    expect(out).toContain('tailscale: Funnel allowed on port 10000');
    expect(out).toContain('tailscale funnel --bg --https=10000 --set-path=/abu http://127.0.0.1:8797');
    expect(m.calls).toEqual([]);
    expect(await readFile(m.envPath, 'utf8')).toBe('TARFA_TOKEN=keep\n');
    await expect(readFile(join(m.home, '.tarfa', 'devices.json'))).rejects.toThrow();
  });

  it('explains itself with --help: Funnel, slugs and the second user', async () => {
    const m = await machine();
    const help = await run(['setup', '--help'], m.env, m.home, m.io);
    expect(help).toContain('funnel');
    expect(help).toContain('--slug');
    expect(help).toContain('sudo tailscale set --operator=$USER');
  });

  it('answers an unknown flag with the usage and exit code 2', async () => {
    const m = await machine();
    await expect(run(['setup', ...FLAGS, '--bogus', 'x'], m.env, m.home, m.io)).rejects.toMatchObject({ exitCode: 2, message: expect.stringContaining('usage: tarfa setup') });
  });

  describe('a package install', () => {
    const LAUNCHER = (home: string) => join(home, '.tarfa', 'bin', 'tarfa-agent');
    const shipped = () => readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'tarfa-agent.sh'), 'utf8');

    it('writes ~/.tarfa/agent.env, the launcher (0755) and a unit that runs it, then changes nothing when rerun', async () => {
      const m = await machine(null, { kind: 'package' });
      const out = await run(['setup', ...FLAGS], m.env, m.home, m.io);
      expect(out).toContain('the phone port answers');
      expect(m.envPath).toBe(join(m.home, '.tarfa', 'agent.env'));
      expect(parseEnvFile(await readFile(m.envPath, 'utf8'))).toMatchObject({ TARFA_MACHINE_ID: 'dev' });
      expect((await stat(m.envPath)).mode & 0o777).toBe(0o600);
      expect(await readFile(LAUNCHER(m.home), 'utf8')).toBe(await shipped());
      expect((await stat(LAUNCHER(m.home))).mode & 0o777).toBe(0o755);
      expect(m.unit()).toContain(`ExecStart=${LAUNCHER(m.home)}`);
      expect(m.calls).toEqual(['install-unit roster=present launcher=present', 'serve 10000/abu http://127.0.0.1:8797 funnel=true', 'restart', 'check']);

      expect(await readFile(join(m.home, '.local', 'bin', 'tarfa'), 'utf8')).toBe(await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'tarfa-cli-wrapper.sh'), 'utf8'));
      expect((await stat(join(m.home, '.local', 'bin', 'tarfa'))).mode & 0o777).toBe(0o755);
      expect(await readlink(join(m.home, '.local', 'bin', 'perch'))).toBe('tarfa');

      m.calls.length = 0;
      const env = await readFile(m.envPath, 'utf8');
      const wrapper = await stat(join(m.home, '.local', 'bin', 'tarfa'));
      expect(await run(['setup', ...FLAGS], m.env, m.home, m.io)).toMatch(/already set up/);
      expect(m.calls).toEqual(['check']);
      expect(await readFile(m.envPath, 'utf8')).toBe(env);
      expect((await stat(join(m.home, '.local', 'bin', 'tarfa'))).mtimeMs).toBe(wrapper.mtimeMs);
    });

    it('moves ~/.perch before writing under ~/.tarfa, so the agent\'s own move never meets two directories', async () => {
      const m = await machine(null, { kind: 'package', legacy: true });
      const legacy = join(m.home, '.perch');
      await mkdir(legacy, { mode: 0o700 });
      const key = await loadOrCreateAgentKeys(join(legacy, 'relay-key.json'));
      await new FileDeviceStore(join(legacy, 'devices.json')).update((roster) => withEnrolmentMode(roster, 'off'));

      await run(['setup', ...FLAGS], m.env, m.home, m.io);
      expect(m.calls.slice(0, 2)).toEqual(['stop-legacy', 'install-unit roster=present launcher=present']);
      expect(await readlink(legacy)).toBe('.tarfa');
      expect((await loadOrCreateAgentKeys(join(m.home, '.tarfa', 'agent-key.json'))).x25519.publicKey).toBe(key.x25519.publicKey);
      expect(await readFile(m.envPath, 'utf8')).toContain("TARFA_MACHINE_ID='dev'");
      const { migrateStateDir } = await import('./infrastructure/state-dir');
      await expect(migrateStateDir(m.home)).resolves.toBe('unchanged');
    });

    it('refuses, writing nothing, when ~/.perch and ~/.tarfa both hold state', async () => {
      const m = await machine(null, { kind: 'package' });
      await mkdir(join(m.home, '.perch'));
      await writeFile(join(m.home, '.perch', 'devices.json'), '{}');
      await mkdir(join(m.home, '.tarfa'));
      await writeFile(join(m.home, '.tarfa', 'status.json'), '{}');
      await expect(run(['setup', ...FLAGS], m.env, m.home, m.io)).rejects.toThrow(/both ~\/\.perch and ~\/\.tarfa/);
      await expect(stat(LAUNCHER(m.home))).rejects.toThrow();
      await expect(stat(m.envPath)).rejects.toThrow();
    });

    it('names the launcher and ~/.tarfa/agent.env in a dry run, changing nothing', async () => {
      const m = await machine(null, { kind: 'package' });
      const out = await run(['setup', ...FLAGS, '--dry-run'], m.env, m.home, m.io);
      expect(out).toContain(LAUNCHER(m.home));
      expect(out).toContain(m.envPath);
      await expect(stat(join(m.home, '.tarfa'))).rejects.toThrow();
    });

    it('on an adopted machine, a source checkout\'s setup reads ~/.tarfa/agent.env and leaves the launcher unit alone', async () => {
      const m = await machine(null, { kind: 'package' });
      await run(['setup', ...FLAGS], m.env, m.home, m.io);
      const unit = m.unit();
      const live = await readFile(m.envPath, 'utf8');
      m.calls.length = 0;
      const fromCheckout: CliIo = { setup: { ...m.io.setup!, installKind: 'clone' } };
      expect(await run(['setup', ...FLAGS], {}, m.home, fromCheckout)).toMatch(/already set up/);
      expect(m.calls).toEqual(['check']);
      expect(m.unit()).toBe(unit);
      expect(await readFile(m.envPath, 'utf8')).toBe(live);
    });

    it('reads machine id, roots, phone port and default path from agent.env on a bare rerun, and changes nothing', async () => {
      const m = await machine(null, { kind: 'package' });
      const second = ['--machine-id', 'dev-2', '--project-roots', '/home/v/a,/home/v/b', '--phone-port', '8798', '--default-path', '/home/v/a', '--address', 'wss://node.example.ts.net:443/v'];
      await run(['setup', ...second], m.env, m.home, m.io);
      const live = await readFile(m.envPath, 'utf8');
      const unit = m.unit();
      const asked: number[] = [];
      const io: CliIo = { setup: { ...m.io.setup!, portOwner: async (port) => (asked.push(port), port === 8798 ? 'ours' : 'free') } };
      m.calls.length = 0;
      expect(await run(['setup'], m.env, m.home, io)).toMatch(/already set up/);
      expect(m.calls).toEqual(['check']);
      expect(asked).toContain(8798);
      expect(await readFile(m.envPath, 'utf8')).toBe(live);
      expect(m.unit()).toBe(unit);
      expect(parseEnvFile(live)).toMatchObject({ TARFA_PHONE_ADDRESSES: 'wss://node.example.ts.net:443/v' });
    });

    it('reads an empty value in agent.env as unset', async () => {
      const m = await machine(null, { kind: 'package' });
      await run(['setup', ...FLAGS], m.env, m.home, m.io);
      await writeFile(m.envPath, `${await readFile(m.envPath, 'utf8')}TARFA_DEFAULT_PATH=\n`, { mode: 0o600 });
      m.calls.length = 0;
      await run(['setup'], m.env, m.home, m.io);
      expect(parseEnvFile(await readFile(m.envPath, 'utf8'))).toMatchObject({ TARFA_PHONE_PORT: '8797', TARFA_MACHINE_ID: 'dev' });
    });

    it('still lets a flag win over agent.env on a rerun', async () => {
      const m = await machine(null, { kind: 'package' });
      await run(['setup', ...FLAGS], m.env, m.home, m.io);
      await run(['setup', '--machine-id', 'renamed'], m.env, m.home, m.io);
      expect(parseEnvFile(await readFile(m.envPath, 'utf8'))).toMatchObject({ TARFA_MACHINE_ID: 'renamed', TARFA_PROJECT_ROOTS: '/home/u/workspace' });
    });

    it('names the env file it read when a value is still missing', async () => {
      const m = await machine(null, { kind: 'package' });
      await expect(run(['setup'], m.env, m.home, m.io)).rejects.toMatchObject({ exitCode: 2, message: expect.stringContaining(`--machine-id is required: letters, digits, . _ - (at most 64) (there is no ${m.envPath} yet to read them from)`) });
      await mkdir(dirname(m.envPath), { recursive: true, mode: 0o700 });
      await writeFile(m.envPath, 'TARFA_TOKEN=t\nTARFA_MACHINE_ID=dev\n', { mode: 0o600 });
      await expect(run(['setup'], m.env, m.home, m.io)).rejects.toThrow(`--project-roots is required: absolute paths, comma-separated (a value not given as a flag is read from ${m.envPath})`);
    });
  });

  describe('adopting a clone install', () => {
    const CLONE_ENV = [
      'TARFA_TOKEN=clone-token',
      'TARFA_MACHINE_ID=dev',
      'TARFA_PROJECT_ROOTS=/home/u/workspace:/home/u/other',
      'TARFA_PORT=8791',
      'TARFA_PHONE_PORT=8797',
      "TARFA_PWA_ORIGIN='https://tarfa.app'",
      '',
    ].join('\n');
    const bin = (home: string, name: string) => join(home, '.local', 'bin', name);

    // A machine whose unit runs <repo>/deploy/run-agent.sh, with the state an adoption must not touch.
    async function cloneMachine(cloneEnv = CLONE_ENV) {
      const m = await machine(null, { kind: 'package' });
      const deploy = join(m.repo, 'deploy');
      await writeFile(join(deploy, 'agent.env'), cloneEnv, { mode: 0o600 });
      await chmod(join(deploy, 'agent.env'), 0o600);
      await mkdir(join(m.repo, 'worktree'));
      await symlink(join(m.repo, 'worktree'), join(deploy, 'agent-live'));
      await writeFile(join(deploy, 'tarfa-cli.sh'), '#!/bin/sh\n');
      await mkdir(join(m.home, '.local', 'bin'), { recursive: true });
      await symlink(join(deploy, 'tarfa-cli.sh'), bin(m.home, 'tarfa'));
      await symlink('tarfa', bin(m.home, 'perch'));
      const state = join(m.home, '.tarfa');
      await mkdir(state, { mode: 0o700 });
      await loadOrCreateAgentKeys(join(state, 'agent-key.json'));
      await new FileDeviceStore(join(state, 'devices.json')).update((roster) => withEnrolmentMode(roster, 'off'));
      await writeFile(join(state, 'parked.json'), '{"parked":[1]}');
      await writeFile(join(state, 'live.json'), '{"live":[2]}');
      const keep = ['agent-key.json', 'devices.json', 'parked.json', 'live.json'];
      const read = async () => Promise.all(keep.map((name) => readFile(join(state, name), 'utf8')));
      const kept = await read();
      const template = await m.io.setup!.service!.template();
      const cloneUnit = renderService(template, { kind: 'clone', repo: m.repo });
      m.setUnit(cloneUnit);
      return { m, deploy, kept, read, cloneUnit, unitBefore: m.unit() };
    }

    it('copies agent.env, repoints the unit, replaces the CLI links, drops agent-live, and keeps every phone paired', async () => {
      const { m, deploy, kept, read, unitBefore } = await cloneMachine();
      const out = await run(['setup', '--adopt'], m.env, m.home, m.io);
      expect(out).toContain('copied');
      expect(out).toContain('kept the old service definition');
      expect(await readFile(join(m.home, '.tarfa', 'agent.env'), 'utf8')).toBe(CLONE_ENV);
      expect((await stat(join(m.home, '.tarfa', 'agent.env'))).mode & 0o777).toBe(0o600);
      expect(await readFile(join(deploy, 'agent.env'), 'utf8')).toBe(CLONE_ENV);
      await expect(lstat(join(deploy, 'agent-live'))).rejects.toThrow();
      expect((await stat(join(m.repo, 'worktree'))).isDirectory()).toBe(true);
      expect(m.unit()).toContain(`ExecStart=${join(m.home, '.tarfa', 'bin', 'tarfa-agent')}`);
      expect(m.unit()).not.toBe(unitBefore);
      expect(m.calls).toEqual(['backup-unit', 'install-unit roster=present launcher=present', 'restart', 'check']);
      expect((await lstat(bin(m.home, 'tarfa'))).isSymbolicLink()).toBe(false);
      expect(await readFile(bin(m.home, 'tarfa'), 'utf8')).toContain('tarfa-cli-wrapper');
      expect((await stat(bin(m.home, 'tarfa'))).mode & 0o777).toBe(0o755);
      expect(await readlink(bin(m.home, 'perch'))).toBe('tarfa');
      expect(await read()).toEqual(kept);
      expect(await readFile(join(deploy, 'tarfa-cli.sh'), 'utf8')).toBe('#!/bin/sh\n');

      m.calls.length = 0;
      expect(await run(['setup', '--adopt'], m.env, m.home, m.io)).toMatch(/already set up/);
      expect(m.calls).toEqual(['check']);
    });

    it('describes every step on a dry run and writes nothing', async () => {
      const { m, deploy, unitBefore, kept, read } = await cloneMachine();
      const out = await run(['setup', '--adopt', '--dry-run'], m.env, m.home, m.io);
      for (const wanted of ['copy ', 'remove the link', 'keeping the old definition', 'wrapper']) expect(out).toContain(wanted);
      expect(m.calls).toEqual([]);
      await expect(stat(join(m.home, '.tarfa', 'agent.env'))).rejects.toThrow();
      expect((await lstat(join(deploy, 'agent-live'))).isSymbolicLink()).toBe(true);
      expect((await lstat(bin(m.home, 'tarfa'))).isSymbolicLink()).toBe(true);
      expect(m.unit()).toBe(unitBefore);
      expect(await read()).toEqual(kept);
    });

    it('adopts without --adopt when setup runs from the package and the unit runs a clone, taking the ports from the clone', async () => {
      const env = CLONE_ENV.replace('TARFA_PHONE_PORT=8797', 'TARFA_PHONE_PORT=8798');
      const { m } = await cloneMachine(env);
      await run(['setup', '--machine-id', 'dev', '--project-roots', '/home/u/workspace,/home/u/other'], m.env, m.home, m.io);
      expect(m.unit()).toContain('tarfa-agent');
      expect(await readFile(join(m.home, '.tarfa', 'agent.env'), 'utf8')).toBe(env);
    });

    it('lets an explicit flag win over the clone\'s env', async () => {
      const { m } = await cloneMachine();
      await run(['setup', '--adopt', '--phone-port', '8799'], m.env, m.home, m.io);
      expect(parseEnvFile(await readFile(join(m.home, '.tarfa', 'agent.env'), 'utf8')).TARFA_PHONE_PORT).toBe('8799');
      expect(await readFile(join(m.repo, 'deploy', 'agent.env'), 'utf8')).toBe(CLONE_ENV);
    });

    it('adopts a machine still on the unit from before the rename, through the service swap', async () => {
      const { m, cloneUnit, kept, read } = await cloneMachine();
      m.setUnit(null);
      m.setLegacyUnit(cloneUnit);
      await run(['setup', '--adopt'], m.env, m.home, m.io);
      expect(m.calls).toEqual(['stop-legacy', 'backup-unit', 'install-unit roster=present launcher=present', 'restart', 'check', 'remove-legacy']);
      expect(await readFile(join(m.home, '.tarfa', 'agent.env'), 'utf8')).toBe(CLONE_ENV);
      expect(m.unit()).toContain('tarfa-agent');
      expect(await read()).toEqual(kept);
    });

    it('refuses from a clone, naming the install, non-zero, writing nothing', async () => {
      const { m } = await cloneMachine();
      const io: CliIo = { setup: { ...m.io.setup!, installKind: 'clone' } };
      await expect(run(['setup', '--adopt'], m.env, m.home, io)).rejects.toMatchObject({ exitCode: 2, message: expect.stringContaining('mise use -g npm:@tarfa/cli@<v>') });
      expect(m.calls).toEqual([]);
      await expect(stat(join(m.home, '.tarfa', 'agent.env'))).rejects.toThrow();
    });

    it('refuses --adopt when nothing is installed, or the unit runs neither a clone nor the launcher', async () => {
      const none = await machine(null, { kind: 'package' });
      await expect(run(['setup', '--adopt'], none.env, none.home, none.io)).rejects.toThrow(/nothing to adopt.*tarfa setup/);
      const { m } = await cloneMachine();
      m.setUnit('[Service]\nExecStart=/usr/bin/other\nKillMode=process\n');
      await expect(run(['setup', '--adopt'], m.env, m.home, m.io)).rejects.toThrow(/neither/);
    });

    it('refuses when the clone has no deploy/agent.env to copy', async () => {
      const { m, deploy } = await cloneMachine();
      await rm(join(deploy, 'agent.env'));
      await expect(run(['setup', '--adopt'], m.env, m.home, m.io)).rejects.toThrow(/no deploy\/agent\.env to adopt/);
      expect(m.calls).toEqual([]);
    });

    it('keeps an existing ~/.tarfa/agent.env from a partial earlier adoption, and says so', async () => {
      const { m } = await cloneMachine();
      await writeFile(join(m.home, '.tarfa', 'agent.env'), CLONE_ENV.replace('clone-token', 'already-here'), { mode: 0o600 });
      const out = await run(['setup', '--adopt'], m.env, m.home, m.io);
      expect(out).toContain('already exists, so it is kept');
      expect(await readFile(join(m.home, '.tarfa', 'agent.env'), 'utf8')).toContain('already-here');
    });

    it('refuses, writing nothing, when deploy/agent-live is not a link', async () => {
      const { m, deploy } = await cloneMachine();
      await rm(join(deploy, 'agent-live'));
      await mkdir(join(deploy, 'agent-live'));
      await expect(run(['setup', '--adopt'], m.env, m.home, m.io)).rejects.toThrow(/not a link/);
      expect(m.calls).toEqual([]);
      await expect(stat(join(m.home, '.tarfa', 'agent.env'))).rejects.toThrow();
      expect((await stat(join(deploy, 'agent-live'))).isDirectory()).toBe(true);
    });

    it('leaves a ~/.local/bin/tarfa that is neither a link into a clone nor the wrapper alone, with one warning', async () => {
      const { m } = await cloneMachine();
      await rm(bin(m.home, 'tarfa'));
      await writeFile(bin(m.home, 'tarfa'), '#!/bin/sh\necho mine\n');
      const out = await run(['setup', '--adopt'], m.env, m.home, m.io);
      expect(out).toContain("is not Tarfa's wrapper");
      expect(await readFile(bin(m.home, 'tarfa'), 'utf8')).toBe('#!/bin/sh\necho mine\n');
    });

    it('reports the failing step and exits non-zero, and a rerun completes it', async () => {
      const { m, kept, read } = await cloneMachine();
      const service = m.io.setup!.service!;
      const install = service.install;
      service.install = async () => {
        throw new Error('systemctl broke');
      };
      await expect(run(['setup', '--adopt'], m.env, m.home, m.io)).rejects.toThrow(/failed: install and enable the agent service.*systemctl broke/);
      expect(m.unit()).toContain('run-agent.sh');
      service.install = install;
      expect(await run(['setup', '--adopt'], m.env, m.home, m.io)).toContain('installed the agent service');
      expect(m.unit()).toContain('tarfa-agent');
      expect(await read()).toEqual(kept);
    });
  });

  describe('tarfa apply', () => {
    const LAUNCHER = (home: string) => join(home, '.tarfa', 'bin', 'tarfa-agent');
    const logs = (text: string) => ({ mark: async () => 0, since: async () => text });
    async function converged() {
      const m = await machine(null, { kind: 'package' });
      await run(['setup', ...FLAGS], m.env, m.home, m.io);
      m.calls.length = 0;
      const withLog = (text: string, over: Partial<NonNullable<CliIo['setup']>> = {}): CliIo => ({ ...m.io, sleep: async () => undefined, setup: { ...m.io.setup!, agentLog: logs(text), ...over } });
      return { m, withLog };
    }

    it('refuses a source install, non-zero, touching nothing', async () => {
      const { m, withLog } = await converged();
      const io = withLog('', { installKind: 'clone' });
      await expect(run(['apply'], {}, m.home, io)).rejects.toMatchObject({ exitCode: 2, message: expect.stringMatching(/source install.*tarfa setup/) });
      expect(m.calls).toEqual([]);
    });

    it('reports one ok line per step, changing nothing when launcher and unit are current', async () => {
      const { m, withLog } = await converged();
      const out = await run(['apply'], { PATH: join(m.home, '.local', 'bin') }, m.home, withLog('tarfa agent: phones on 127.0.0.1:8797\n'));
      expect(out.split('\n')).toEqual([
        'ok: launcher already current',
        'ok: service definition already current',
        'ok: hooks already current',
        'ok: restarted (restarted)',
        'ok: the phone port answers on 127.0.0.1:8797',
        'ok: the log shows phones on',
        'ok: tarfa command wrapper already current',
      ]);
      expect(m.calls).toEqual(['restart', 'check']);
    });

    it('rewrites a stale launcher and unit, then restarts', async () => {
      const { m, withLog } = await converged();
      await writeFile(join(m.home, '.tarfa', 'bin', 'tarfa-agent'), '#!/bin/sh\nold\n');
      const io = withLog('phones on\n');
      io.setup!.service = { ...io.setup!.service!, installed: async () => '[Service]\nExecStart=/old\n' };
      const out = await run(['apply'], {}, m.home, io);
      expect(out).toContain('ok: launcher written');
      expect(out).toContain('ok: service definition written, daemon reloaded');
      expect(await readFile(join(m.home, '.tarfa', 'bin', 'tarfa-agent'), 'utf8')).not.toContain('old');
      expect(m.calls.at(-3)).toMatch(/^install-unit/);
      expect(m.calls.at(-4)).toBe('backup-unit');
      expect(out).toContain('(the previous text is kept at /unit.bak-1)');
    });

    it('re-enables a text-current unit that is disabled, without a backup, and still restarts', async () => {
      const { m, withLog } = await converged();
      const io = withLog('phones on\n');
      io.setup!.service = { ...io.setup!.service!, enabled: async () => false };
      const out = await run(['apply'], {}, m.home, io);
      expect(out).toContain('ok: service definition written, daemon reloaded\n');
      expect(out).toContain('ok: restarted');
      expect(m.calls).toEqual(['install-unit roster=present launcher=present', 'restart', 'check']);
    });

    it('warns when another tarfa comes first on PATH, and still succeeds', async () => {
      const { m, withLog } = await converged();
      const other = join(m.home, 'proj', 'node_modules', '.bin');
      await mkdir(other, { recursive: true });
      await writeFile(join(other, 'tarfa'), '#!/bin/sh\n', { mode: 0o755 });
      const out = await run(['apply'], { PATH: `${other}:${join(m.home, '.local', 'bin')}` }, m.home, withLog('phones on\n'));
      expect(out).toContain(`warning: \`tarfa\` on your PATH is ${join(other, 'tarfa')}`);
      expect(out).toContain('ok: tarfa command wrapper already current');
    });

    it('setup refuses a TARFA_AGENT_ENV other than ~/.tarfa/agent.env, which the launcher always reads', async () => {
      const m = await machine(null, { kind: 'package' });
      await expect(run(['setup', ...FLAGS], { TARFA_AGENT_ENV: '/elsewhere/agent.env' }, m.home, m.io)).rejects.toThrow(/TARFA_AGENT_ENV names \/elsewhere\/agent\.env.*unset TARFA_AGENT_ENV/);
      expect(m.calls).toEqual([]);
      await run(['setup', ...FLAGS], { TARFA_AGENT_ENV: join(m.home, '.tarfa', '..', '.tarfa', 'agent.env') }, m.home, m.io);
      expect(m.calls).toContain('restart');
    });

    it('stops at a failed restart, names the step, exits non-zero', async () => {
      const { m, withLog } = await converged();
      const io = withLog('phones on\n', { restart: { restart: async () => { throw new Error('systemctl --user restart tarfa-agent failed: Unit not found'); } } });
      const failed = run(['apply'], {}, m.home, io);
      await expect(failed).rejects.toThrow(/failed: restart: systemctl --user restart tarfa-agent failed/);
      expect(m.calls).toEqual([]);
    });

    it('fails when the log has no phones-on line since the restart', async () => {
      const { m, withLog } = await converged();
      await expect(run(['apply'], {}, m.home, withLog('tarfa agent: version 1\n'))).rejects.toThrow(/failed: log:/);
    });

    it('refuses before changing anything on a machine never set up, or with no roster', async () => {
      const never = await machine(null, { kind: 'package' });
      await expect(run(['apply'], {}, never.home, never.io)).rejects.toThrow(/failed: check: no agent config.*tarfa setup/);
      const m = await machine('TARFA_MACHINE_ID=dev\nTARFA_TOKEN=t\n', { kind: 'package' });
      await expect(run(['apply'], {}, m.home, m.io)).rejects.toThrow(/failed: check: no device roster.*tarfa setup/);
      await expect(stat(LAUNCHER(m.home))).rejects.toThrow();
    });
  });
});

describe('tarfa update', () => {
  const calls: string[] = [];
  const package_: CliIo = {
    setup: { installKind: 'package' },
    update: {
      currentVersion: () => '0.1.0',
      findMise: () => '/mise',
      install: async (_m, v) => void calls.push(`install ${v}`),
      locate: async () => ({ node: '/n', cli: '/c' }),
      apply: async () => 0,
      log: () => undefined,
    },
  };

  it('refuses from a source install with exactly one line, exit 2, before any network', async () => {
    const fetched: string[] = [];
    const io: CliIo = { ...package_, setup: { installKind: 'clone' }, fetch: (async (url: string) => (fetched.push(url), new Response('{}'))) as unknown as typeof fetch };
    await expect(run(['update'], {}, '/h', io)).rejects.toMatchObject({ exitCode: 2, message: 'this is a source install; git pull' });
    expect(fetched).toEqual([]);
  });

  it('says so when the newest is already installed, and only --force goes on', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ 'dist-tags': { latest: '0.1.0' } }))) as unknown as typeof fetch;
    calls.length = 0;
    expect(await run(['update'], {}, '/h', { ...package_, fetch: fetchFn })).toContain('already on 0.1.0');
    expect(calls).toEqual([]);
    expect(await run(['update', '--force'], {}, '/h', { ...package_, fetch: fetchFn })).toBe('updated 0.1.0 to 0.1.0');
    expect(calls).toEqual(['install 0.1.0']);
  });

  it('fails in one line, non-zero, when the registry cannot be reached', async () => {
    const down = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    calls.length = 0;
    await expect(run(['update'], {}, '/h', { ...package_, fetch: down })).rejects.toThrow(/npm registry.*nothing changed/);
    expect(calls).toEqual([]);
  });

  it('takes --version, and refuses anything else', async () => {
    calls.length = 0;
    expect(await run(['update', '--version', '0.0.9'], {}, '/h', package_)).toBe('updated 0.1.0 to 0.0.9');
    await expect(run(['update', '--version', '1.0.0; id'], {}, '/h', package_)).rejects.toMatchObject({ exitCode: 2 });
    await expect(run(['update', '--bogus'], {}, '/h', package_)).rejects.toMatchObject({ exitCode: 2 });
  });
});

// `ls`, `spawn` and `peek` run against a fake tmux: these tests never reach a tmux server.
describe('tarfa ls / spawn / peek (fake tmux)', () => {
  const NOW = 1_800_000_000_000;
  const live: TmuxSessionInfo[] = [
    { name: 'perch-aaaaaa', startPath: '/w/foo', command: 'claude', createdAt: NOW - 3_600_000, title: '✳ Fix login' },
    { name: 'perch-bbbbbb', startPath: '/w/bar', command: 'claude', createdAt: NOW - 60_000, parent: 'perch-aaaaaa', title: '✳ Child' },
    { name: 'perch-hhhhhh', startPath: '/w/secret/x', command: 'claude', createdAt: NOW, title: '✳ Hidden' },
  ];

  function fakeTmux(pane: Record<string, string> = {}, extra: TmuxSessionInfo[] = []) {
    const created: Array<{ name: string; cwd: string; command: string; parent?: string; storedCommand?: string; codexThread?: string }> = [];
    const locked: string[] = [];
    const titles: string[] = [];
    const tmux: TmuxPort = {
      listSessions: async (prefix) => [...live, ...extra].filter((s) => s.name.startsWith(prefix)),
      createSession: async (input) => {
        created.push(input);
      },
      killSession: async () => {
        throw new Error('ls/spawn/peek must never kill');
      },
      hasSession: async (name) => live.some((s) => s.name === name) || created.some((c) => c.name === name),
      setPaneTitle: async (name, title) => {
        titles.push(`${name} ${title}`);
      },
      supportsTitleLock: async () => true,
      lockPaneTitle: async (name) => {
        locked.push(name);
      },
      capturePane: async () => 'old\n\nline 1\n   \nline 2\nline 3\n\n\n',
      sessionOfPane: async (id) => pane[id] ?? null,
    };
    return { tmux, created, locked, titles };
  }

  async function machine() {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.tmp');
    await mkdir(root, { recursive: true });
    const home = await mkdtemp(join(root, 'cli-ls-'));
    tmpDirs.push(home);
    await mkdir(join(home, '.tarfa'));
    await writeFile(join(home, '.tarfa', 'hidden-folders.json'), '["secret"]');
    // No agent.env at all: these commands must work from any repo's session.
    const env = { TARFA_AGENT_ENV: join(home, 'no-such-agent.env') };
    return { home, env };
  }

  // The brief file is named by a nonce; the launch command names it.
  const spawnedBrief = (home: string, created: Array<{ name: string; command: string }>, id: string) => {
    const path = /cat '([^']+)'/.exec(created.find((c) => c.name === id)!.command)![1]!;
    expect(path.startsWith(join(home, '.tarfa', 'spawn'))).toBe(true);
    return readFile(path, 'utf8');
  };

  const io = (tmux: TmuxPort, extra: Partial<CliIo> = {}): CliIo => ({ tmux, now: () => NOW, sleep: async () => {}, ...extra });

  it('lists live and parked workspaces with their stored status, without an agent.env', async () => {
    const { home, env } = await machine();
    await writeFile(join(home, '.tarfa', 'status.json'), JSON.stringify({ 'perch-bbbbbb': { status: 'needs-feedback', changedAt: NOW - 120_000, urgent: true } }));
    await writeFile(
      join(home, '.tarfa', 'parked.json'),
      JSON.stringify([{ id: 'perch-pppppp', name: 'Parked one', projectPath: '/w/foo', command: 'claude', machineId: 'm', createdAt: 1, parkedAt: NOW - 86_400_000 }]),
    );
    const out = await run(['ls'], env, home, io(fakeTmux().tmux));
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/^ID +NAME +STATUS +AGE +ROLE +PARENT +TITLE +FOLDER$/);
    expect(out).toMatch(/perch-aaaaaa +- +idle +1h +orchestrator +- +Fix login +\/w\/foo/);
    expect(out).toMatch(/perch-bbbbbb +- +needs-feedback \(urgent\) +2m +child +perch-aaaaaa +Child/);
    expect(out).toMatch(/perch-pppppp +- +parked +1d +normal /);
    expect(out).not.toContain('perch-hhhhhh');
    const json = JSON.parse(await run(['ls', '--json'], env, home, io(fakeTmux().tmux))) as Workspace[];
    expect(json.map((w) => w.id)).toEqual(['perch-aaaaaa', 'perch-bbbbbb', 'perch-pppppp']);
    expect(json[0]!.machineId).toBe(hostname().split('.')[0]);
    expect(json[1]!.parentId).toBe('perch-aaaaaa');
    expect(json.map((w) => (w as Workspace & { role: string }).role)).toEqual(['orchestrator', 'child', 'normal']);
  });

  it('shows a child whose last act was SendMessage as waiting on its orchestrator', async () => {
    const { home, env } = await machine();
    await writeFile(join(home, '.tarfa', 'status.json'), JSON.stringify({ 'perch-bbbbbb': { status: 'working', changedAt: NOW, messagedLast: true } }));
    const json = JSON.parse(await run(['ls', '--json'], env, home, io(fakeTmux().tmux))) as Workspace[];
    expect(json.find((w) => w.id === 'perch-bbbbbb')?.waitingOn).toBe('parent');
    expect(await run(['ls'], env, home, io(fakeTmux().tmux))).toMatch(/perch-bbbbbb +- +needs-orchestrator /);
  });

  it('never writes the status file it reads', async () => {
    const { home, env } = await machine();
    const status = JSON.stringify({ 'perch-gone00': { status: 'working', changedAt: 1 } });
    await writeFile(join(home, '.tarfa', 'status.json'), status);
    await run(['ls'], env, home, io(fakeTmux().tmux));
    expect(await readFile(join(home, '.tarfa', 'status.json'), 'utf8')).toBe(status);
  });

  it('still lists when status.json or parked.json is corrupt, missing, or not a file', async () => {
    const { home, env } = await machine();
    await writeFile(join(home, '.tarfa', 'status.json'), '{not json');
    await writeFile(join(home, '.tarfa', 'parked.json'), '[{"x"');
    expect(await run(['ls'], env, home, io(fakeTmux().tmux))).toContain('perch-aaaaaa');
    await rm(join(home, '.tarfa', 'status.json'));
    await rm(join(home, '.tarfa', 'parked.json'));
    expect(await run(['ls'], env, home, io(fakeTmux().tmux))).toContain('perch-aaaaaa');
    await mkdir(join(home, '.tarfa', 'status.json'));
    await mkdir(join(home, '.tarfa', 'parked.json'));
    expect(await run(['ls'], env, home, io(fakeTmux().tmux))).toContain('perch-aaaaaa');
  });

  it('filters by role, keeping the role the whole list gives', async () => {
    const { home, env } = await machine();
    const ids = async (...argv: string[]) => (JSON.parse(await run(['ls', '--json', ...argv], env, home, io(fakeTmux().tmux))) as Workspace[]).map((w) => w.id);
    expect(await ids('--role', 'orchestrator')).toEqual(['perch-aaaaaa']);
    expect(await ids('--role', 'child')).toEqual(['perch-bbbbbb']);
    expect(await ids('--role', 'normal')).toEqual([]);
    await expect(run(['ls', '--role', 'boss'], env, home, io(fakeTmux().tmux))).rejects.toThrow(/usage: tarfa ls/);
  });

  it('filters by project path: the directory and everything under it, relative to the caller', async () => {
    const { home, env } = await machine();
    const ids = async (cwd: string, ...argv: string[]) =>
      (JSON.parse(await run(['ls', '--json', ...argv], env, home, io(fakeTmux().tmux, { cwd }))) as Workspace[]).map((w) => w.id);
    expect(await ids('/', '--path', '/w/foo')).toEqual(['perch-aaaaaa']);
    expect(await ids('/', '--path', '/w')).toEqual(['perch-aaaaaa', 'perch-bbbbbb']);
    expect(await ids('/w', '--path', 'bar')).toEqual(['perch-bbbbbb']);
    expect(await ids('/w/bar', '--path', '.')).toEqual(['perch-bbbbbb']);
    expect(await ids('/', '--path', '/w/fo')).toEqual([]);
    const out = await run(['ls', '--path', '/w/bar'], env, home, io(fakeTmux().tmux, { cwd: '/' }));
    expect(out).toMatch(/perch-bbbbbb .* child +perch-aaaaaa/);
  });

  it('matches --path through a symlink, since spawn stores the resolved folder', async () => {
    const { home, env } = await machine();
    const real = await realpath(await mkdtemp(join(home, 'real-')));
    await symlink(real, join(home, 'link'));
    await writeFile(
      join(home, '.tarfa', 'parked.json'),
      JSON.stringify([{ id: 'perch-pppppp', name: 'Parked one', projectPath: real, command: 'claude', machineId: 'm', createdAt: 1, parkedAt: NOW }]),
    );
    const out = await run(['ls', '--json', '--path', join(home, 'link')], env, home, io(fakeTmux().tmux, { cwd: '/' }));
    expect((JSON.parse(out) as Workspace[]).map((w) => w.id)).toEqual(['perch-pppppp']);
  });

  it('filters by parent, and --mine by the workspace the caller runs in', async () => {
    const { home, env } = await machine();
    const { tmux } = fakeTmux({ '%7': 'perch-aaaaaa' });
    const ids = (out: string) => (JSON.parse(out) as Workspace[]).map((w) => w.id);
    expect(ids(await run(['ls', '--json', '--parent', 'perch-aaaaaa'], env, home, io(tmux)))).toEqual(['perch-bbbbbb']);
    expect(ids(await run(['ls', '--json', '--mine'], { ...env, TMUX_PANE: '%7' }, home, io(tmux)))).toEqual(['perch-bbbbbb']);
    await expect(run(['ls', '--mine'], env, home, io(tmux))).rejects.toThrow(/TMUX_PANE/);
    await expect(run(['ls', '--mine'], { ...env, TMUX_PANE: '%8' }, home, io(tmux))).rejects.toThrow(/not inside a Tarfa workspace/);
    await expect(run(['ls', '--parent'], env, home, io(tmux))).rejects.toThrow(/usage: tarfa ls/);
  });

  it('unparks through the running agent, one line per id, failing if any did not open', async () => {
    const { home } = await machine();
    await writeFile(join(home, '.tarfa', 'token'), 'hook-secret');
    const env = { TARFA_AGENT_ENV: join(home, 'agent.env') };
    await writeFile(env.TARFA_AGENT_ENV, 'TARFA_PORT=9911\n');
    const calls: Array<{ url: string; auth: string; body: string }> = [];
    const results: Record<string, string> = { 'perch-aaaaaa': 'unparked', 'perch-bbbbbb': 'not-parked', 'perch-cccccc': 'missing-directory' };
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const body = String(init?.body);
      calls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') ?? '', body });
      const { id } = JSON.parse(body) as { id: string };
      return new Response(JSON.stringify({ result: results[id] }), { status: 200 });
    };
    expect(await run(['unpark', 'perch-aaaaaa'], env, home, io(fakeTmux().tmux, { fetch }))).toBe('perch-aaaaaa: opened');
    expect(calls[0]).toEqual({ url: 'http://127.0.0.1:9911/unpark', auth: 'Bearer hook-secret', body: '{"id":"perch-aaaaaa"}' });
    // Every id is tried; the failures are reported together.
    await expect(run(['unpark', 'perch-bbbbbb', 'perch-aaaaaa', 'perch-cccccc'], env, home, io(fakeTmux().tmux, { fetch }))).rejects.toThrow(
      'perch-bbbbbb: not parked\nperch-aaaaaa: opened\nperch-cccccc: its project directory no longer exists',
    );
    await expect(run(['unpark'], env, home, io(fakeTmux().tmux, { fetch }))).rejects.toThrow(/usage: tarfa unpark/);
  });

  it('says the agent is not running when nothing answers', async () => {
    const { home, env } = await machine();
    await writeFile(join(home, '.tarfa', 'token'), 'hook-secret');
    const fetch = async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
    };
    await expect(run(['unpark', 'perch-aaaaaa'], env, home, io(fakeTmux().tmux, { fetch }))).rejects.toThrow(/agent is not running/);
    await rm(join(home, '.tarfa', 'token'));
    await expect(run(['unpark', 'perch-aaaaaa'], env, home, io(fakeTmux().tmux, { fetch }))).rejects.toThrow(/agent is not running/);
  });

  describe('close', () => {
    async function closing(results: Record<string, string> = {}) {
      const { home } = await machine();
      await writeFile(join(home, '.tarfa', 'token'), 'hook-secret');
      const env = { TARFA_AGENT_ENV: join(home, 'agent.env') };
      await writeFile(env.TARFA_AGENT_ENV, 'TARFA_PORT=9911\n');
      const calls: Array<{ url: string; auth: string; body: string }> = [];
      const fetch = async (url: string | URL | Request, init?: RequestInit) => {
        const body = String(init?.body);
        calls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') ?? '', body });
        const { id } = JSON.parse(body) as { id: string };
        return Response.json({ result: results[id] ?? 'closed' });
      };
      return { home, env, calls, fetch };
    }

    it('closes through the running agent, one line per id', async () => {
      const { home, env, calls, fetch } = await closing();
      expect(await run(['close', 'perch-aaaaaa', 'perch-bbbbbb'], env, home, io(fakeTmux().tmux, { fetch }))).toBe('perch-aaaaaa: closed\nperch-bbbbbb: closed');
      expect(calls[0]).toEqual({ url: 'http://127.0.0.1:9911/close', auth: 'Bearer hook-secret', body: '{"id":"perch-aaaaaa"}' });
    });

    it('tries every id and fails if any does not exist', async () => {
      const { home, env, calls, fetch } = await closing({ 'perch-nope': 'no-such-workspace' });
      await expect(run(['close', 'perch-nope', 'perch-aaaaaa'], env, home, io(fakeTmux().tmux, { fetch }))).rejects.toThrow(
        'perch-nope: no such workspace (see tarfa ls)\nperch-aaaaaa: closed',
      );
      expect(calls).toHaveLength(2);
    });

    // The close would kill the command asking for it before it could report anything.
    it('refuses to close the workspace it runs in, before closing any other', async () => {
      const { home, env, calls, fetch } = await closing();
      const inside = { ...env, TMUX_PANE: '%1' };
      await expect(run(['close', 'perch-bbbbbb', 'perch-aaaaaa'], inside, home, io(fakeTmux({ '%1': 'perch-aaaaaa' }).tmux, { fetch }))).rejects.toThrow(/perch-aaaaaa is this workspace/);
      expect(calls).toEqual([]);
    });

    it('closes from a shell outside any workspace', async () => {
      const { home, env, fetch } = await closing();
      expect(await run(['close', 'perch-aaaaaa'], { ...env, TMUX_PANE: '%9' }, home, io(fakeTmux().tmux, { fetch }))).toBe('perch-aaaaaa: closed');
    });

    it('names an agent too old to have the route, and keeps what it already closed', async () => {
      const { home, env } = await closing();
      let first = true;
      const fetch = async () => {
        if (first) {
          first = false;
          return Response.json({ result: 'closed' });
        }
        return new Response(null, { status: 404 });
      };
      await expect(run(['close', 'perch-aaaaaa', 'perch-bbbbbb'], env, home, io(fakeTmux().tmux, { fetch }))).rejects.toThrow(
        'perch-aaaaaa: closed\nperch-bbbbbb: the agent answered 404 (it predates tarfa close: restart it)',
      );
    });

    it('answers a missing id or a flag with the usage and exit code 2', async () => {
      const { home, env, fetch } = await closing();
      await expect(run(['close'], env, home, io(fakeTmux().tmux, { fetch }))).rejects.toMatchObject({ exitCode: 2, message: expect.stringContaining('usage: tarfa close') });
      await expect(run(['close', '--all'], env, home, io(fakeTmux().tmux, { fetch }))).rejects.toMatchObject({ exitCode: 2 });
    });
  });

  describe('wait', () => {
    // Time moves only when the command sleeps; `onSleep` changes the world between two polls.
    function clock(onSleep: (now: number) => Promise<void> | void = () => {}) {
      let now = NOW;
      return {
        now: () => now,
        sleep: async (ms: number) => {
          now += ms;
          await onSleep(now);
        },
        elapsed: () => now - NOW,
      };
    }
    const setStatus = (home: string, entries: Record<string, unknown>) => writeFile(join(home, '.tarfa', 'status.json'), JSON.stringify(entries));

    it('blocks while the child works, then prints its id and state, re-reading the store each poll', async () => {
      const { home, env } = await machine();
      await setStatus(home, { 'perch-bbbbbb': { status: 'working' } });
      const c = clock(async (now) => {
        if (now - NOW >= 30_000) await setStatus(home, { 'perch-bbbbbb': { status: 'needs-feedback' } });
      });
      expect(await run(['wait', 'perch-bbbbbb'], env, home, io(fakeTmux().tmux, c))).toBe('perch-bbbbbb needs-feedback');
      expect(c.elapsed()).toBeGreaterThanOrEqual(30_000);
    });

    it('prints needs-orchestrator for a child that ended its turn on a message to its parent', async () => {
      const { home, env } = await machine();
      await setStatus(home, { 'perch-bbbbbb': { status: 'working', messagedLast: true } });
      expect(await run(['wait', 'perch-bbbbbb'], env, home, io(fakeTmux().tmux, clock()))).toBe('perch-bbbbbb needs-orchestrator');
    });

    it('returns on the first of several, naming each one stopped', async () => {
      const { home, env } = await machine();
      await setStatus(home, { 'perch-aaaaaa': { status: 'working' }, 'perch-bbbbbb': { status: 'working' } });
      expect(await run(['wait', 'perch-aaaaaa', 'perch-bbbbbb', 'perch-gone00'], env, home, io(fakeTmux().tmux, clock()))).toBe('perch-gone00 gone');
    });

    // `ls` hides these folders, but a child living in one is not gone.
    it('follows a workspace in a hidden folder', async () => {
      const { home, env } = await machine();
      await setStatus(home, { 'perch-hhhhhh': { status: 'working' } });
      const c = clock(async (now) => {
        if (now - NOW >= 4000) await setStatus(home, { 'perch-hhhhhh': { status: 'needs-feedback' } });
      });
      expect(await run(['wait', 'perch-hhhhhh'], env, home, io(fakeTmux().tmux, c))).toBe('perch-hhhhhh needs-feedback');
    });

    it('exits 124 on the timeout, naming what it waited on', async () => {
      const { home, env } = await machine();
      await setStatus(home, { 'perch-bbbbbb': { status: 'working' } });
      const c = clock();
      await expect(run(['wait', 'perch-bbbbbb', '--timeout', '30'], env, home, io(fakeTmux().tmux, c))).rejects.toMatchObject({
        exitCode: 124,
        message: expect.stringContaining('no stop to report: perch-bbbbbb'),
      });
      expect(c.elapsed()).toBe(30_000);
    });

    // A Codex sandbox that blocks tmux's socket reads like a machine with no server at all, and
    // every child would be reported gone.
    it('fails rather than call every child gone when tmux lists nothing on the first look', async () => {
      const { home, env } = await machine();
      const tmux: TmuxPort = { ...fakeTmux().tmux, listSessions: async () => [] };
      await expect(run(['wait', 'perch-bbbbbb'], env, home, io(tmux, clock()))).rejects.toThrow(/tmux lists no session/);
    });

    it('reports gone when tmux stops listing anything after the first look', async () => {
      const { home, env } = await machine();
      await setStatus(home, { 'perch-bbbbbb': { status: 'working' } });
      const real = fakeTmux().tmux;
      let polls = 0;
      const tmux: TmuxPort = { ...real, listSessions: async (prefix) => (polls++ === 0 ? real.listSessions(prefix) : []) };
      expect(await run(['wait', 'perch-bbbbbb'], env, home, io(tmux, clock()))).toBe('perch-bbbbbb gone');
    });

    it('answers bad arguments with the usage and exit code 2', async () => {
      const { home, env } = await machine();
      for (const argv of [['wait'], ['wait', '--timeout', '30'], ['wait', 'perch-bbbbbb', '--timeout', '0'], ['wait', 'perch-bbbbbb', '--timeout', '9'], ['wait', 'perch-bbbbbb', '--timeout', 'soon'], ['wait', '--mine']]) {
        await expect(run(argv, env, home, io(fakeTmux().tmux, clock()))).rejects.toMatchObject({ exitCode: 2, message: expect.stringContaining('usage: tarfa wait') });
      }
    });
  });

  describe('send', () => {
    async function agent(answer: (body: Record<string, unknown>) => Response = () => Response.json({ result: 'delivered' })) {
      const { home } = await machine();
      await writeFile(join(home, '.tarfa', 'token'), 'hook-secret');
      const env = { TARFA_AGENT_ENV: join(home, 'agent.env'), TMUX_PANE: '%3' };
      await writeFile(env.TARFA_AGENT_ENV, 'TARFA_PORT=9911\n');
      const calls: Array<{ url: string; auth: string; body: Record<string, unknown> }> = [];
      const fetch = async (url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        calls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') ?? '', body });
        return answer(body);
      };
      return { home, env, calls, fetch };
    }

    it('send posts pane, pid, to and body to /message', async () => {
      const { home, env, calls, fetch } = await agent();
      expect(await run(['send', 'perch-orch-1', 'done: see PR'], env, home, io(fakeTmux().tmux, { fetch }))).toBe('delivered to perch-orch-1');
      expect(calls).toEqual([
        {
          url: 'http://127.0.0.1:9911/message',
          auth: 'Bearer hook-secret',
          body: { pane: '%3', pid: process.pid, to: 'perch-orch-1', body: 'done: see PR' },
        },
      ]);
    });

    it('send reads the body from stdin when no message argument', async () => {
      const { home, env, calls, fetch } = await agent();
      const stdin = async () => 'a long\nreport\n';
      expect(await run(['send', 'perch-orch-1'], env, home, io(fakeTmux().tmux, { fetch, stdin }))).toBe('delivered to perch-orch-1');
      expect(calls[0]!.body.body).toBe('a long\nreport\n');
    });

    it('send refuses --file and extra arguments with usage', async () => {
      const { home, env, calls, fetch } = await agent();
      const usage = /usage: tarfa send <workspace id> "<message>"/;
      for (const argv of [['send'], ['send', 'perch-orch-1', 'a', 'b'], ['send', '--file', 'x', 'perch-orch-1'], ['send', 'perch-orch-1', '-f', 'x']]) {
        await expect(run(argv, env, home, io(fakeTmux().tmux, { fetch }))).rejects.toThrow(usage);
      }
      await expect(run(['send', 'perch-orch-1', 'hi'], { ...env, TMUX_PANE: undefined }, home, io(fakeTmux().tmux, { fetch }))).rejects.toThrow(
        'not inside a Tarfa workspace: $TMUX_PANE is unset',
      );
      expect(calls).toEqual([]);
    });

    // Codex bound to its daemon runs tools outside the pane, with the daemon's stale TMUX_PANE or
    // none: the thread id is what names the sender there.
    it('send from Codex posts its thread id too', async () => {
      const { home, env, calls, fetch } = await agent();
      await run(['send', 'perch-orch-1', 'hi'], { ...env, CODEX_THREAD_ID: 't1' }, home, io(fakeTmux().tmux, { fetch }));
      expect(calls[0]!.body).toEqual({ pane: '%3', pid: process.pid, to: 'perch-orch-1', body: 'hi', codexThread: 't1' });
    });

    it('send from Codex does not need TMUX_PANE', async () => {
      const { home, env, calls, fetch } = await agent();
      const codexEnv = { ...env, TMUX_PANE: undefined, CODEX_THREAD_ID: 't1' };
      expect(await run(['send', 'perch-orch-1', 'hi'], codexEnv, home, io(fakeTmux().tmux, { fetch }))).toBe('delivered to perch-orch-1');
      expect(calls[0]!.body).toMatchObject({ pane: '', codexThread: 't1' });
    });

    it('a refusal throws its reason', async () => {
      const { home, env, fetch } = await agent(() => Response.json({ result: 'refused', reason: 'cannot message yourself' }));
      await expect(run(['send', 'perch-child-1', 'hi'], env, home, io(fakeTmux().tmux, { fetch }))).rejects.toThrow('cannot message yourself');
    });

    it('agent not running', async () => {
      const { home, env } = await agent();
      const fetch = async () => {
        throw new TypeError('fetch failed');
      };
      await expect(run(['send', 'perch-orch-1', 'hi'], env, home, io(fakeTmux().tmux, { fetch }))).rejects.toThrow(/agent is not running.*retry in a few seconds/);
    });

    it('a permanent refusal carries no retry hint', async () => {
      const { home, env, fetch } = await agent(() => Response.json({ result: 'refused', reason: 'no workspace perch-x on this machine' }));
      await expect(run(['send', 'perch-x', 'hi'], env, home, io(fakeTmux().tmux, { fetch }))).rejects.toThrow(/^no workspace perch-x on this machine$/);
    });
  });

  it('spawns from the caller cwd with the brief from stdin, and prints the id', async () => {
    const { home, env } = await machine();
    await mkdir(join(home, 'proj'));
    const { tmux, created, locked } = fakeTmux();
    const id = await run(['spawn', '--title', 'T', 'proj'], env, home, io(tmux, { cwd: home, stdin: async () => 'Do it.\n' }));
    expect(id).toBe('proj-1');
    expect(created[0]!.cwd).toBe(await realpath(join(home, 'proj')));
    expect(created[0]!.storedCommand).toBe(`claude --model 'opus[1m]' --name ${id}`);
    // The title is held by tmux's lock, not by the env switch that also silences OSC 7501.
    expect(locked).toEqual([id]);
    expect(created[0]!.command).not.toContain('CLAUDE_CODE_DISABLE_TERMINAL_TITLE');
    expect(await spawnedBrief(home, created, id)).toBe('Do it.\n');
  });

  it('spawns a child of the caller, telling it to ask the parent with tarfa send', async () => {
    const { home, env } = await machine();
    const { tmux, created } = fakeTmux({ '%7': 'perch-aaaaaa' });
    const id = await run(['spawn', '--child', '--model', 'sonnet[1m]', home], { ...env, TMUX_PANE: '%7' }, home, io(tmux, { stdin: async () => 'b' }));
    expect(created[0]!.parent).toBe('perch-aaaaaa');
    expect(created[0]!.storedCommand).toContain("--model 'sonnet[1m]'");
    const brief = await spawnedBrief(home, created, id);
    expect(brief).toContain('tarfa send perch-aaaaaa "');
  });

  it('spawns a codex child on a thread the app server creates', async () => {
    const { home, env } = await machine();
    const { tmux, created } = fakeTmux({ '%7': 'perch-aaaaaa' });
    const threads: unknown[] = [];
    const codex = {
      versions: async () => ({ cli: '0.166.0', appServer: '0.166.0' }),
      createThread: async (input: unknown) => {
        threads.push(input);
        return 'th-9';
      },
    };
    await run(['spawn', '--child', '--cli', 'codex', home], { ...env, TMUX_PANE: '%7' }, home, io(tmux, { stdin: async () => 'b', codex }));
    expect(threads).toMatchObject([{ firstMessage: 'b' }]);
    expect(created[0]).toMatchObject({ command: 'codex resume th-9', parent: 'perch-aaaaaa', codexThread: 'th-9' });
  });

  // Codex under its daemon runs tools outside the pane, with the TMUX_PANE of whichever pane
  // started the daemon: the thread names the caller.
  const codexCaller = { name: 'perch-cccccc', startPath: '/w/foo', command: 'codex resume th-1', codexThread: 'th-1', createdAt: NOW, title: '' };

  it('names a Codex caller by its thread, not by a stale TMUX_PANE', async () => {
    const { home, env } = await machine();
    const { tmux, created } = fakeTmux({ '%7': 'perch-aaaaaa' }, [codexCaller]);
    const codexEnv = { ...env, TMUX_PANE: '%7', CODEX_THREAD_ID: 'th-1' };
    await run(['spawn', '--child', home], codexEnv, home, io(tmux, { stdin: async () => 'b' }));
    expect(created[0]!.parent).toBe('perch-cccccc');
    const mine = JSON.parse(await run(['ls', '--json', '--mine'], codexEnv, home, io(tmux))) as Workspace[];
    expect(mine).toEqual([]);
  });

  it('refuses a Codex caller whose thread no workspace records', async () => {
    const { home, env } = await machine();
    const { tmux, created } = fakeTmux({ '%7': 'perch-aaaaaa' }, [codexCaller]);
    const codexEnv = { ...env, TMUX_PANE: '%7', CODEX_THREAD_ID: 'zz' };
    const refusal = 'not inside a Tarfa workspace: no workspace records Codex thread zz';
    await expect(run(['spawn', '--child', home], codexEnv, home, io(tmux, { stdin: async () => 'b' }))).rejects.toThrow(refusal);
    await expect(run(['rename', 'x'], codexEnv, home, io(tmux))).rejects.toThrow(refusal);
    await expect(run(['ls', '--mine'], codexEnv, home, io(tmux))).rejects.toThrow(refusal);
    expect(created).toEqual([]);
  });

  it('spawns pi through pi-reviewed', async () => {
    const { home, env } = await machine();
    const { tmux, created } = fakeTmux();
    const asked: string[] = [];
    const resolveCommand = async (name: string) => (asked.push(name), true);
    await run(['spawn', '--cli', 'pi', home], env, home, io(tmux, { stdin: async () => 'b', resolveCommand }));
    expect(created[0]!.storedCommand).toBe('pi-reviewed');
    expect(asked).toEqual(['pi-reviewed']);
  });

  it('refuses a pi spawn when pi-reviewed is not on the login PATH', async () => {
    const { home, env } = await machine();
    const { tmux, created } = fakeTmux();
    const resolveCommand = async () => false;
    await expect(run(['spawn', '--cli', 'pi', home], env, home, io(tmux, { stdin: async () => 'b', resolveCommand }))).rejects.toThrow(
      'tarfa spawn --cli pi needs pi-reviewed on PATH',
    );
    expect(created).toEqual([]);
  });

  it('rejects --cli bash', async () => {
    const { home, env } = await machine();
    const { tmux, created } = fakeTmux();
    await expect(run(['spawn', '--cli', 'bash', home], env, home, io(tmux, { stdin: async () => 'b' }))).rejects.toThrow(
      'usage: tarfa spawn [--title <title>] [--child] [--model <model>] [--cli claude|codex|pi] <projectPath>',
    );
    expect(created).toEqual([]);
  });

  it('gives a spawn the smallest free id for its folder', async () => {
    const { home, env } = await machine();
    const project = join(home, 'My.App');
    await mkdir(project);
    const { tmux } = fakeTmux();
    const first = await run(['spawn', project], env, home, io(tmux, { stdin: async () => 'b' }));
    const second = await run(['spawn', project], env, home, io(tmux, { stdin: async () => 'b' }));
    expect([first, second]).toEqual(['my-app-1', 'my-app-2']);
  });

  it('renames the caller, or the workspace a first word names, under a locked title', async () => {
    const { home, env } = await machine();
    const { tmux, locked, titles } = fakeTmux({ '%7': 'perch-aaaaaa' });
    const pane = { ...env, TMUX_PANE: '%7' };
    expect(await run(['rename', 'Invoice', 'PDF', 'fix'], pane, home, io(tmux))).toBe('perch-aaaaaa: renamed to "Invoice PDF fix"');
    expect(await run(['rename', 'perch-bbbbbb', 'Child', 'two'], pane, home, io(tmux))).toBe('perch-bbbbbb: renamed to "Child two"');
    // One word is always a title, even one that looks like an id.
    expect(await run(['rename', 'perch-bbbbbb'], pane, home, io(tmux))).toBe('perch-aaaaaa: renamed to "perch-bbbbbb"');
    expect(locked).toEqual(['perch-aaaaaa', 'perch-bbbbbb', 'perch-aaaaaa']);
    expect(titles).toEqual(['perch-aaaaaa ✳ Invoice PDF fix', 'perch-bbbbbb ✳ Child two', 'perch-aaaaaa ✳ perch-bbbbbb']);
    await expect(run(['rename', 'perch-9', 'x'], pane, home, io(tmux))).rejects.toThrow(/no workspace perch-9/);
    await expect(run(['rename'], pane, home, io(tmux))).rejects.toThrow(/usage: tarfa rename/);
    await expect(run(['rename', 'x'], env, home, io(tmux))).rejects.toThrow(/TMUX_PANE/);
  });

  it('refuses a child outside a Tarfa pane, and a spawn without a path', async () => {
    const { home, env } = await machine();
    const { tmux, created } = fakeTmux({ '%9': 'main' });
    const stdin = async () => 'b';
    await expect(run(['spawn', '--child', home], env, home, io(tmux, { stdin }))).rejects.toThrow(/TMUX_PANE/);
    await expect(run(['spawn', '--child', home], { ...env, TMUX_PANE: '%9' }, home, io(tmux, { stdin }))).rejects.toThrow(/session is main/);
    await expect(run(['spawn'], env, home, io(tmux, { stdin }))).rejects.toThrow(/usage: tarfa spawn/);
    await expect(run(['spawn', join(home, 'nope')], env, home, io(tmux, { stdin }))).rejects.toThrow(/not a directory/);
    expect(created).toEqual([]);
  });

  it('peeks at a status line and the last non-blank lines of the pane', async () => {
    const { home, env } = await machine();
    const out = await run(['peek', 'perch-aaaaaa', '-n', '2'], env, home, io(fakeTmux().tmux));
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/^ID /);
    expect(lines[1]).toMatch(/^perch-aaaaaa +- +idle/);
    expect(lines.slice(2)).toEqual(['', 'line 2', 'line 3']);
    expect((await run(['peek', 'perch-aaaaaa'], env, home, io(fakeTmux().tmux))).split('\n').slice(3)).toEqual(['old', 'line 1', 'line 2', 'line 3']);
    await expect(run(['peek', 'perch-zzzzzz'], env, home, io(fakeTmux().tmux))).rejects.toThrow(/no workspace perch-zzzzzz/);
    await expect(run(['peek'], env, home, io(fakeTmux().tmux))).rejects.toThrow(/usage: tarfa peek/);
    await expect(run(['peek', 'perch-aaaaaa', '-n', 'x'], env, home, io(fakeTmux().tmux))).rejects.toThrow(/usage: tarfa peek/);
  });

  it('says a parked workspace has no pane to peek at', async () => {
    const { home, env } = await machine();
    await writeFile(
      join(home, '.tarfa', 'parked.json'),
      JSON.stringify([{ id: 'perch-pppppp', name: 'P', projectPath: '/w/foo', command: 'claude', machineId: 'm', createdAt: 1, parkedAt: NOW }]),
    );
    expect(await run(['peek', 'perch-pppppp'], env, home, io(fakeTmux().tmux))).toContain('parked: no pane until it is opened');
  });
});
