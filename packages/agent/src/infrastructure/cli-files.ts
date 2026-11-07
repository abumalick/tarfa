import { constants } from 'node:fs';
import { access, chmod, copyFile, lstat, mkdir, readFile, readlink, realpath, rename, rm, stat, symlink, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { CliEntry } from '../application/cli-wrapper';

const MAX_WRAPPER_BYTES = 64 * 1024;

async function lstatOrNull(path: string) {
  try {
    return await lstat(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function readCliEntry(path: string): Promise<CliEntry> {
  const stats = await lstatOrNull(path);
  if (stats === null) return { kind: 'absent' };
  if (stats.isSymbolicLink()) return { kind: 'link', target: resolve(dirname(path), await readlink(path)) };
  if (stats.isFile() && stats.size <= MAX_WRAPPER_BYTES) return { kind: 'file', text: await readFile(path, 'utf8') };
  return { kind: 'other' };
}

// `perch -> tarfa`, swapped in whole so a failure leaves the old entry.
export async function linkPerch(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  await rm(temp, { force: true });
  try {
    await symlink('tarfa', temp);
    await rename(temp, path);
  } catch (err) {
    await rm(temp, { force: true });
    throw err;
  }
}

// Never overwrites: a file already at `to` is a partial earlier adoption, and the plan keeps it.
export async function copyEnvOnce(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true, mode: 0o700 });
  await copyFile(from, to, constants.COPYFILE_EXCL);
  await chmod(to, 0o600);
}

export async function linkKind(path: string): Promise<'absent' | 'link' | 'other'> {
  const stats = await lstatOrNull(path);
  if (stats === null) return 'absent';
  return stats.isSymbolicLink() ? 'link' : 'other';
}

// Only ever a symlink: a real file or folder there is the owner's.
export async function removeLink(path: string): Promise<void> {
  const kind = await linkKind(path);
  if (kind === 'other') throw new Error(`${path} is not a link: not removing it`);
  if (kind === 'link') await unlink(path);
}

// The first executable file called `name` on a PATH value, as the shell would find it.
export async function firstOnPath(name: string, pathVar: string): Promise<{ path: string; real: string } | null> {
  for (const dir of pathVar.split(':')) {
    const candidate = join(dir === '' ? '.' : dir, name);
    const ok = await access(candidate, constants.X_OK).then(() => stat(candidate).then((s) => s.isFile()), () => false);
    if (ok) return { path: candidate, real: await realpath(candidate) };
  }
  return null;
}
