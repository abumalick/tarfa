import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWrite } from './atomic-write';

const dirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tarfa-atomic-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await chmod(dir, 0o700).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

describe('atomicWrite', () => {
  it('creates the file with the mode, and its folders', async () => {
    const dir = await scratch();
    const path = join(dir, 'bin', 'tarfa-agent');
    await atomicWrite(path, '#!/bin/sh\n', 0o755);
    expect(await readFile(path, 'utf8')).toBe('#!/bin/sh\n');
    expect((await stat(path)).mode & 0o777).toBe(0o755);
    expect(await readdir(join(dir, 'bin'))).toEqual(['tarfa-agent']);
  });

  it('replaces an existing file whole, and sets the mode on it', async () => {
    const dir = await scratch();
    const path = join(dir, 'unit');
    await writeFile(path, 'old\n', { mode: 0o600 });
    await atomicWrite(path, 'new\n', 0o644);
    expect(await readFile(path, 'utf8')).toBe('new\n');
    expect((await stat(path)).mode & 0o777).toBe(0o644);
  });

  it('leaves the previous file in place, and no temp file, when the write fails', async () => {
    const dir = await scratch();
    const path = join(dir, 'unit');
    await writeFile(path, 'old\n');
    await chmod(dir, 0o500);
    await expect(atomicWrite(path, 'new\n', 0o644)).rejects.toThrow();
    await chmod(dir, 0o700);
    expect(await readFile(path, 'utf8')).toBe('old\n');
    expect(await readdir(dir)).toEqual(['unit']);
  });

  it('removes its temp file when the rename fails', async () => {
    const dir = await scratch();
    await writeFile(join(dir, 'x'), '');
    await rm(join(dir, 'x'));
    const path = join(dir, 'taken');
    await atomicWrite(join(path, 'inner'), 'keep\n', 0o644);
    await expect(atomicWrite(path, 'new\n', 0o644)).rejects.toThrow();
    expect(await readdir(dir)).toEqual(['taken']);
    expect(await readFile(join(path, 'inner'), 'utf8')).toBe('keep\n');
  });
});
