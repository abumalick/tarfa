import { describe, it, expect } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
      const { stdout: packed } = await exec('pnpm', ['pack', '--pack-destination', tarballs], { cwd: AGENT_DIR });
      const tarball = join(tarballs, packed.trim().split('\n').pop()!.split('/').pop()!);

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

      for (const wanted of [
        'dist/cli.js',
        'dist/serve.js',
        'templates/tarfa-agent.service',
        'templates/app.tarfa.agent.plist',
        'src/hooks/tarfa-hook.sh',
        'src/hooks/tarfa-guard.sh',
        'scripts/postinstall.mjs',
      ]) {
        expect(listing).toContain(`package/${wanted}`);
      }
      expect(listing.filter((p) => /\.tsx?$/.test(p) || /pwa|packages\//.test(p))).toEqual([]);
      for (const js of listing.filter((p) => p.startsWith('package/dist/') && p.endsWith('.js'))) {
        const text = (await exec('tar', ['-xzOf', tarball, js], { maxBuffer: 64 * 1024 * 1024 })).stdout;
        expect(text, js).not.toMatch(/from ["']@tarfa\//);
      }

      await exec(process.execPath, [npmCli, 'install', '--global', '--prefix', prefix, '--allow-scripts=@tarfa/cli,node-pty', '--no-audit', '--no-fund', tarball], { env: cleanEnv, timeout: 540_000 });
      const pkgDir = join(prefix, 'lib', 'node_modules', '@tarfa', 'cli');
      const bin = join(prefix, 'bin', 'tarfa');

      const expected = (JSON.parse(await readFile(join(AGENT_DIR, 'package.json'), 'utf8')) as { version: string }).version;
      expect((await exec(bin, ['--version'], { env: cleanEnv })).stdout.trim()).toBe(expected);
      expect((await exec(join(prefix, 'bin', 'perch'), ['--version'], { env: cleanEnv })).stdout.trim()).toBe(expected);

      const ptyProbe = `const pty = require('node-pty'); const p = pty.spawn('echo', ['pty-works'], {}); let out = ''; p.onData((d) => (out += d)); p.onExit(() => { process.stdout.write(out); });`;
      expect((await exec(process.execPath, ['-e', ptyProbe], { cwd: pkgDir, env: cleanEnv })).stdout).toContain('pty-works');

      const hooksPort = await freePort();
      const phonePort = await freePort();
      await mkdir(join(home, '.tarfa'), { mode: 0o700 });
      const agentEnv = join(home, '.tarfa', 'agent.env');
      const settings = {
        TARFA_TOKEN: 'pack-test-token',
        TARFA_MACHINE_ID: 'pack-test',
        TARFA_PROJECT_ROOTS: home,
        TARFA_PORT: String(hooksPort),
        TARFA_PHONE_PORT: String(phonePort),
      };
      await writeFile(agentEnv, `${Object.entries(settings).map(([k, v]) => `${k}=${v}`).join('\n')}\n`, { mode: 0o600 });
      await chmod(agentEnv, 0o600);
      const serveEnv = { ...cleanEnv, ...settings, TARFA_AGENT_ENV: agentEnv, TMUX_TMPDIR: tmuxTmp };

      const homeBefore = await snapshot(home);
      const dry = await exec(
        bin,
        ['setup', '--machine-id', 'pack-test', '--project-roots', home, '--phone-port', String(phonePort), '--tailscale', 'none', '--dry-run'],
        { env: { ...serveEnv, TARFA_PORT: undefined, TARFA_PHONE_PORT: undefined, TARFA_TOKEN: undefined, TARFA_MACHINE_ID: undefined, TARFA_PROJECT_ROOTS: undefined } },
      );
      expect(dry.stdout.length).toBeGreaterThan(0);
      expect(await snapshot(home)).toEqual(homeBefore);

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
