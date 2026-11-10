import { readFile, stat } from 'node:fs/promises';
import { parseDictationKeys, type DictationKeys } from '../application/dictation-keys';
import { exposedFiles } from '../application/private-files';
import type { DictationKeysPort, DictationKeysWriter } from '../ports/dictation-keys-port';
import { atomicWrite } from './atomic-write';
import { withFileLock } from './file-lock';

const STALE_LOCK_MS = 10_000;

// ~/.tarfa/dictation-keys.json, read fresh on every request so `tarfa dictation-key set` reaches
// the next phone that connects with no restart. The startup check sees only a file that existed
// then, so each read checks the mode itself.
export class FileDictationKeysStore implements DictationKeysPort, DictationKeysWriter {
  constructor(
    private readonly path: string,
    private readonly report: (problem: string) => void = () => {},
  ) {}

  async load(): Promise<{ keys: DictationKeys } | { problem: string }> {
    let mode: number;
    try {
      mode = (await stat(this.path)).mode;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { keys: {} };
      return { problem: `${this.path} cannot be read (${(err as NodeJS.ErrnoException).code ?? 'error'})` };
    }
    const exposed = exposedFiles([{ path: this.path, mode }]);
    if (exposed.length > 0) return { problem: exposed[0]! };
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (err) {
      return { problem: `${this.path} cannot be read (${(err as NodeJS.ErrnoException).code ?? 'error'})` };
    }
    const keys = parseDictationKeys(raw);
    return keys === 'malformed' ? { problem: `${this.path} is malformed` } : { keys };
  }

  async read(): Promise<DictationKeys> {
    const loaded = await this.load();
    if ('problem' in loaded) {
      this.report(loaded.problem);
      return {};
    }
    return loaded.keys;
  }

  async update(change: (keys: DictationKeys) => DictationKeys): Promise<{ ok: true } | { problem: string }> {
    return withFileLock(this.path, STALE_LOCK_MS, async () => {
      const loaded = await this.load();
      if ('problem' in loaded) return { problem: loaded.problem };
      await atomicWrite(this.path, `${JSON.stringify(change(loaded.keys), null, 2)}\n`, 0o600);
      return { ok: true as const };
    });
  }
}
