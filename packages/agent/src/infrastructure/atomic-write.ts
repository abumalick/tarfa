import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Temp file and rename, so a failure at any point leaves the previous file whole: what a service
// manager reads at the next start is never half-written.
export async function atomicWrite(path: string, text: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  try {
    await writeFile(temp, text, { mode });
    await chmod(temp, mode);
    await rename(temp, path);
  } catch (err) {
    await rm(temp, { force: true });
    throw err;
  }
}
