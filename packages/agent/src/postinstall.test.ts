import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, '..', 'scripts', 'postinstall.mjs');
const ROOT = join(here, '..', '..', '..', '.tmp');
let dir: string;
let n = 0;

beforeAll(async () => {
  await mkdir(ROOT, { recursive: true });
  dir = await mkdtemp(join(ROOT, 'postinstall-'));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

// A package dir holding the script, with an optional node-pty beside it in node_modules.
async function install(ptyPrebuilds: string[] | null): Promise<{ run: () => void; helper: (platform: string) => string }> {
  const pkg = join(dir, `p${n++}`);
  await mkdir(join(pkg, 'scripts'), { recursive: true });
  await copyFile(SCRIPT, join(pkg, 'scripts', 'postinstall.mjs'));
  if (ptyPrebuilds) {
    const pty = join(pkg, 'node_modules', 'node-pty');
    await mkdir(pty, { recursive: true });
    await writeFile(join(pty, 'package.json'), '{"name":"node-pty","version":"0.0.0"}');
    for (const platform of ptyPrebuilds) {
      await mkdir(join(pty, 'prebuilds', platform), { recursive: true });
      await writeFile(join(pty, 'prebuilds', platform, 'spawn-helper'), '');
      await chmod(join(pty, 'prebuilds', platform, 'spawn-helper'), 0o644);
    }
  }
  return {
    run: () => void execFileSync(process.execPath, [join(pkg, 'scripts', 'postinstall.mjs')], { stdio: 'pipe' }),
    helper: (platform) => join(pkg, 'node_modules', 'node-pty', 'prebuilds', platform, 'spawn-helper'),
  };
}

describe('postinstall', () => {
  it('makes every prebuilt spawn-helper executable', async () => {
    const p = await install(['darwin-arm64', 'darwin-x64']);
    p.run();
    for (const platform of ['darwin-arm64', 'darwin-x64']) expect((await stat(p.helper(platform))).mode & 0o111).toBe(0o111);
  });

  it('succeeds when node-pty has no prebuilds, as on Linux', async () => {
    const p = await install([]);
    expect(() => p.run()).not.toThrow();
  });

  it('succeeds when node-pty cannot be resolved', async () => {
    const p = await install(null);
    expect(() => p.run()).not.toThrow();
  });
});
