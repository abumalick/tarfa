import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { copyEnvOnce, linkKind, linkPerch, readCliEntry, removeLink } from './cli-files';

const dirs: string[] = [];
async function scratch() {
  const dir = await mkdtemp(join(tmpdir(), 'tarfa-cli-files-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('readCliEntry', () => {
  it('tells nothing, a file, a link (resolved against its folder) and anything else apart', async () => {
    const dir = await scratch();
    expect(await readCliEntry(join(dir, 'tarfa'))).toEqual({ kind: 'absent' });
    await writeFile(join(dir, 'file'), 'text');
    expect(await readCliEntry(join(dir, 'file'))).toEqual({ kind: 'file', text: 'text' });
    await symlink('file', join(dir, 'rel'));
    expect(await readCliEntry(join(dir, 'rel'))).toEqual({ kind: 'link', target: join(dir, 'file') });
    await symlink('/elsewhere/deploy/tarfa-cli.sh', join(dir, 'dangling'));
    expect(await readCliEntry(join(dir, 'dangling'))).toEqual({ kind: 'link', target: '/elsewhere/deploy/tarfa-cli.sh' });
    await mkdir(join(dir, 'folder'));
    expect(await readCliEntry(join(dir, 'folder'))).toEqual({ kind: 'other' });
    await writeFile(join(dir, 'big'), 'x'.repeat(70 * 1024));
    expect(await readCliEntry(join(dir, 'big'))).toEqual({ kind: 'other' });
  });
});

describe('linkPerch', () => {
  it('replaces a link to a clone with perch -> tarfa, making the folder when needed, leaving no temp', async () => {
    const dir = await scratch();
    const perch = join(dir, 'bin', 'perch');
    await linkPerch(perch);
    expect(await readlink(perch)).toBe('tarfa');
    await rm(perch);
    await symlink('/clone/deploy/perch-cli.sh', perch);
    await linkPerch(perch);
    expect(await readlink(perch)).toBe('tarfa');
    expect(await readdir(join(dir, 'bin'))).toEqual(['perch']);
  });
});

describe('copyEnvOnce', () => {
  it('copies to 0600 in a 0700 folder, keeps the original, and never overwrites', async () => {
    const dir = await scratch();
    const from = join(dir, 'clone.env');
    await writeFile(from, 'A=1\n', { mode: 0o644 });
    await chmod(from, 0o644);
    const to = join(dir, 'state', 'agent.env');
    await copyEnvOnce(from, to);
    expect(await readFile(to, 'utf8')).toBe('A=1\n');
    expect((await stat(to)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, 'state'))).mode & 0o777).toBe(0o700);
    expect((await stat(from)).mode & 0o777).toBe(0o644);
    await writeFile(from, 'A=2\n');
    await expect(copyEnvOnce(from, to)).rejects.toThrow(/EEXIST/);
    expect(await readFile(to, 'utf8')).toBe('A=1\n');
  });
});

describe('linkKind and removeLink', () => {
  it('removes a link (dangling too) and nothing else', async () => {
    const dir = await scratch();
    const path = join(dir, 'agent-live');
    expect(await linkKind(path)).toBe('absent');
    await removeLink(path);
    await mkdir(join(dir, 'target'));
    await symlink(join(dir, 'target'), path);
    expect(await linkKind(path)).toBe('link');
    await removeLink(path);
    await expect(lstat(path)).rejects.toThrow();
    expect((await stat(join(dir, 'target'))).isDirectory()).toBe(true);
    await symlink(join(dir, 'gone'), path);
    await removeLink(path);
    await expect(lstat(path)).rejects.toThrow();

    await writeFile(path, 'mine');
    expect(await linkKind(path)).toBe('other');
    await expect(removeLink(path)).rejects.toThrow(/not a link/);
    expect(await readFile(path, 'utf8')).toBe('mine');
    await rm(path);
    await mkdir(path);
    await expect(removeLink(path)).rejects.toThrow(/not a link/);
  });
});
