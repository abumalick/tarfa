import { describe, it, expect } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Opt-in, since it packs the package and installs the tarball (compiling node-pty): set
// TARFA_PACK_TEST=1. It is the proof that what `pnpm pack` produces runs with nothing of the
// repository around it, so it belongs before a release, not in the commit gate.
//
// ISOLATION: a scratch HOME and npm prefix, a PATH holding only node's own directory and the
// system's, ports found free beforehand, and a tmux server of its own (TMUX_TMPDIR, no $TMUX),
// torn down by its socket path and never by name.
const ENABLED = process.env.TARFA_PACK_TEST === '1';
const exec = promisify(execFile);
const AGENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH_ROOT = join(AGENT_DIR, '..', '..', '.tmp');

// A git hook exports GIT_DIR and friends, which any git a child runs would obey.
function noGitVars(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('GIT_')));
}

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  server.close();
  await once(server, 'close');
  return port;
}

// Every file under dir with its size and mtime, to see that nothing was written.
async function snapshot(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isDirectory()) continue;
    const path = join(entry.parentPath, entry.name);
    const s = await stat(path);
    out.push(`${path} ${s.size} ${s.mtimeMs}`);
  }
  return out.sort();
}

describe.skipIf(!ENABLED)('the packed @tarfa/cli', () => {
  it('installs from its tarball and runs with nothing of the repository around it', async () => {
    await mkdir(SCRATCH_ROOT, { recursive: true });
    const scratch = await mkdtemp(join(SCRATCH_ROOT, 'pack-'));
    const home = join(scratch, 'home');
    const prefix = join(scratch, 'prefix');
    const tmuxTmp = join(scratch, 'tmux');
    const tarballs = join(scratch, 'tarballs');
    await Promise.all([home, prefix, tmuxTmp, tarballs].map((d) => mkdir(d, { recursive: true })));
    const nodeDir = dirname(process.execPath);
    // Not the `npm` on PATH: a version manager's wrapper reshims through itself after a global install.
    const npmCli = join(dirname(nodeDir), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const cleanEnv: NodeJS.ProcessEnv = {
      HOME: home,
      PATH: `${nodeDir}:/usr/bin:/bin`,
      XDG_RUNTIME_DIR: `/run/user/${process.getuid?.() ?? 0}`,
      npm_config_nodedir: dirname(nodeDir),
    };
    let server: ReturnType<typeof spawn> | undefined;
    try {
      // The release workflow names the tarball it stages, so what is tested is what is published.
      let tarball = process.env.TARFA_PACK_TARBALL;
      if (!tarball) {
        const { stdout: packed } = await exec('pnpm', ['pack', '--pack-destination', tarballs], { cwd: AGENT_DIR, env: noGitVars(process.env) });
        tarball = join(tarballs, packed.trim().split('\n').pop()!.split('/').pop()!);
      }

      const listing = (await exec('tar', ['-tzf', tarball])).stdout.trim().split('\n');
      const manifestText = (await exec('tar', ['-xzOf', tarball, 'package/package.json'])).stdout;
      const manifest = JSON.parse(manifestText) as Record<string, Record<string, string> | string>;
      expect(manifestText).not.toContain('workspace:');
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        expect(Object.keys((manifest[field] as Record<string, string> | undefined) ?? {}).filter((n) => n.startsWith('@tarfa/'))).toEqual([]);
      }
      expect(Object.keys(manifest.dependencies as Record<string, string>).sort()).toEqual(['node-pty', 'qr', 'ws', 'zod']);
      expect(manifest.repository).toMatchObject({ url: 'https://github.com/abumalick/tarfa' });
      expect(manifest.private).toBeUndefined();
      expect(Object.keys((manifest.scripts as Record<string, string> | undefined) ?? {}).filter((n) => /^(pre|post)?install$|^prepare$/.test(n))).toEqual([]);
      expect(listing).toContain('package/LICENSE');

      for (const wanted of [
        'dist/cli.js',
        'dist/serve.js',
        'templates/tarfa-agent.service',
        'templates/app.tarfa.agent.plist',
        'templates/tarfa-cli-wrapper.sh',
        'src/hooks/tarfa-hook.sh',
        'src/hooks/tarfa-guard.sh',
      ]) {
        expect(listing).toContain(`package/${wanted}`);
      }
      expect(listing.filter((p) => /\.tsx?$/.test(p) || /pwa|packages\//.test(p))).toEqual([]);
      for (const js of listing.filter((p) => p.startsWith('package/dist/') && p.endsWith('.js'))) {
        const text = (await exec('tar', ['-xzOf', tarball, js], { maxBuffer: 64 * 1024 * 1024 })).stdout;
        expect(text, js).not.toMatch(/from ["']@tarfa\//);
      }

      await exec(process.execPath, [npmCli, 'install', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', tarball], { env: cleanEnv, timeout: 540_000 });
      const pkgDir = join(prefix, 'lib', 'node_modules', '@tarfa', 'cli');
      const bin = join(prefix, 'bin', 'tarfa');

      const expected = (JSON.parse(await readFile(join(AGENT_DIR, 'package.json'), 'utf8')) as { version: string }).version;
      expect((await exec(bin, ['--version'], { env: cleanEnv })).stdout.trim()).toBe(expected);
      expect((await exec(join(prefix, 'bin', 'perch'), ['--version'], { env: cleanEnv })).stdout.trim()).toBe(expected);

      // Installed the way a version manager does, with no lifecycle script run: node-pty must load
      // its prebuilt binding, and the helper it spawns through must already be executable.
      const ptyDir = join(pkgDir, 'node_modules', 'node-pty');
      const platformDir = join(ptyDir, 'prebuilds', `${process.platform}-${process.arch}`);
      expect(await stat(join(platformDir, 'pty.node')).then(() => true, () => false)).toBe(true);
      expect(await stat(join(ptyDir, 'build')).then(() => true, () => false)).toBe(false);
      const helper = await stat(join(platformDir, 'spawn-helper')).catch(() => null);
      if (helper) expect(helper.mode & 0o111).toBe(0o111);
      const ptyProbe = `const pty = require('node-pty'); const p = pty.spawn('echo', ['pty-works'], {}); let out = ''; p.onData((d) => (out += d)); p.onExit(() => { process.stdout.write(out); });`;
      expect((await exec(process.execPath, ['-e', ptyProbe], { cwd: pkgDir, env: cleanEnv })).stdout).toContain('pty-works');

      const hooksPort = await freePort();
      const phonePort = await freePort();
      await mkdir(join(home, '.tarfa'), { mode: 0o700 });
      const agentEnv = join(home, '.tarfa', 'agent.env');
      const settings = {
        TARFA_MACHINE_ID: 'pack-test',
        TARFA_PROJECT_ROOTS: home,
        TARFA_PORT: String(hooksPort),
        TARFA_PHONE_PORT: String(phonePort),
      };
      await writeFile(agentEnv, `${Object.entries(settings).map(([k, v]) => `${k}=${v}`).join('\n')}\n`, { mode: 0o600 });
      await chmod(agentEnv, 0o600);
      const serveEnv = { ...cleanEnv, ...settings, TARFA_AGENT_ENV: agentEnv, TMUX_TMPDIR: tmuxTmp };

      // The hook scripts come from the installed package, not from a checkout.
      await exec(bin, ['install-hooks'], { env: { ...serveEnv, TARFA_PORT: undefined } });
      for (const script of ['tarfa-hook.sh', 'tarfa-guard.sh']) {
        const installed = join(home, '.tarfa', script);
        expect(await readFile(installed, 'utf8')).toBe(await readFile(join(pkgDir, 'src', 'hooks', script), 'utf8'));
        expect((await stat(installed)).mode & 0o111).toBe(0o111);
      }

      const homeBefore = await snapshot(home);
      const dry = await exec(
        bin,
        ['setup', '--machine-id', 'pack-test', '--project-roots', home, '--phone-port', String(phonePort), '--tailscale', 'none', '--dry-run'],
        { env: { ...serveEnv, TARFA_PORT: undefined, TARFA_PHONE_PORT: undefined, TARFA_MACHINE_ID: undefined, TARFA_PROJECT_ROOTS: undefined } },
      );
      expect(dry.stdout).toContain(join(home, '.tarfa', 'bin', 'tarfa-agent'));
      expect(dry.stdout).toContain(join(home, '.tarfa', 'agent.env'));
      expect(await snapshot(home)).toEqual(homeBefore);

      // The wrapper setup installs runs the installed package under an explicit node, from any folder,
      // in both layouts mise's npm backend makes: npm's (<install>/bin/tarfa) and aube's, where the
      // package sits under <install>/node_modules behind a link and .bin/tarfa is a shell script.
      const miseStub = join(home, '.local', 'bin', 'mise');
      await mkdir(dirname(miseStub), { recursive: true });
      const stubMiseAt = (install: string) =>
        writeFile(
          miseStub,
          `#!/bin/sh\nif [ "$1" = "--cd" ] && [ "$3" = "where" ]; then case "$4" in npm:@tarfa/cli) echo "${install}" ;; node) echo "${dirname(nodeDir)}" ;; esac; exit 0; fi\nexit 1\n`,
          { mode: 0o755 },
        );
      const wrapper = join(pkgDir, 'templates', 'tarfa-cli-wrapper.sh');
      const elsewhere = join(scratch, 'elsewhere');
      await mkdir(elsewhere);
      const runWrapped = async () => (await exec('sh', [wrapper, '--version'], { cwd: elsewhere, env: { HOME: home, PATH: '/usr/bin:/bin' } })).stdout.trim();
      await stubMiseAt(prefix);
      expect(await runWrapped()).toBe(expected);
      const aube = join(scratch, 'aube-install');
      await mkdir(join(aube, 'node_modules', '@tarfa'), { recursive: true });
      await symlink(pkgDir, join(aube, 'node_modules', '@tarfa', 'cli'));
      await stubMiseAt(aube);
      expect(await runWrapped()).toBe(expected);
      await stubMiseAt(prefix);
      expect((await exec(process.execPath, [bin, '--version'], { env: cleanEnv })).stdout.trim()).toBe(expected);

      // An unreachable registry is one line and changes nothing.
      const closedPort = await freePort();
      const updateBefore = await snapshot(home);
      const failedUpdate = await exec(bin, ['update'], { env: { ...cleanEnv, TARFA_NPM_REGISTRY: `http://127.0.0.1:${closedPort}` } }).then(
        () => ({ code: 0, stderr: '' }),
        (err: { code: number; stderr: string }) => ({ code: err.code, stderr: err.stderr }),
      );
      expect(failedUpdate.code).not.toBe(0);
      expect(failedUpdate.stderr.trim().split('\n')).toHaveLength(1);
      expect(failedUpdate.stderr).toMatch(/npm registry.*nothing changed/);
      expect(await snapshot(home)).toEqual(updateBefore);

      // Adopting a clone, on a scratch unit that names a scratch clone: described, nothing written.
      const adoptHome = join(scratch, 'adopt-home');
      const clone = join(scratch, 'clone');
      const stubBin = join(scratch, 'stubbin');
      await Promise.all([join(adoptHome, '.config', 'systemd', 'user'), join(clone, 'deploy'), stubBin].map((d) => mkdir(d, { recursive: true })));
      await writeFile(join(clone, 'deploy', 'run-agent.sh'), '#!/usr/bin/env bash\n');
      await writeFile(join(clone, 'deploy', 'agent.env'), `TARFA_MACHINE_ID=adopt-test\nTARFA_PROJECT_ROOTS=${adoptHome}\nTARFA_PORT=${await freePort()}\nTARFA_PHONE_PORT=${await freePort()}\nTARFA_PHONE_ADDRESSES=wss://adopt-test.example.ts.net/adopt\n`, { mode: 0o600 });
      await symlink(clone, join(clone, 'deploy', 'agent-live'));
      await writeFile(join(adoptHome, '.config', 'systemd', 'user', 'tarfa-agent.service'), `[Service]\nExecStart=/usr/bin/env bash ${clone}/deploy/run-agent.sh\nKillMode=process\n`);
      for (const tool of ['systemctl', 'loginctl']) await writeFile(join(stubBin, tool), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      const adoptEnv = { HOME: adoptHome, PATH: `${stubBin}:${nodeDir}:/usr/bin:/bin`, XDG_RUNTIME_DIR: cleanEnv.XDG_RUNTIME_DIR };
      const adoptBefore = [await snapshot(adoptHome), await snapshot(clone)];
      const adopted = await exec(bin, ['setup', '--adopt', '--dry-run'], { env: adoptEnv });
      for (const wanted of ['copy ', 'remove the link', 'keeping the old definition', 'wrapper']) expect(adopted.stdout).toContain(wanted);
      expect([await snapshot(adoptHome), await snapshot(clone)]).toEqual(adoptBefore);

      const before = await snapshot(pkgDir);
      server = spawn(bin, ['serve'], { env: serveEnv, stdio: ['ignore', 'pipe', 'pipe'] });
      let log = '';
      server.stdout!.on('data', (d: Buffer) => (log += d.toString()));
      server.stderr!.on('data', (d: Buffer) => (log += d.toString()));
      const exited = once(server, 'exit').then(() => 'exited');
      const deadline = Date.now() + 30_000;
      while (!log.includes('phones on') && Date.now() < deadline && (await Promise.race([exited, new Promise((r) => setTimeout(() => r('waiting'), 100))])) === 'waiting');
      expect(log).toContain(`tarfa agent: version ${expected}`);
      expect(log).toContain(`phones on 127.0.0.1:${phonePort}`);
      server.kill('SIGTERM');
      await exited;
      server = undefined;
      expect(await snapshot(pkgDir)).toEqual(before);
    } finally {
      if (server && server.exitCode === null) server.kill('SIGKILL');
      const socket = join(tmuxTmp, `tmux-${process.getuid?.() ?? 0}`, 'default');
      if (await stat(socket).then(() => true, () => false)) await exec('tmux', ['-S', socket, 'kill-server']).catch(() => undefined);
      await rm(scratch, { recursive: true, force: true });
    }
  }, 600_000);
});
