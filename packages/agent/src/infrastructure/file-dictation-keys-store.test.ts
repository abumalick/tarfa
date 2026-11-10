import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileDictationKeysStore } from './file-dictation-keys-store';

let dir: string;
let file: string;
let problems: string[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tarfa-dictation-keys-'));
  file = join(dir, 'dictation-keys.json');
  problems = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const store = () => new FileDictationKeysStore(file, (problem) => problems.push(problem));

describe('FileDictationKeysStore', () => {
  it('holds no keys when the file is missing, and says nothing', async () => {
    expect(await store().read()).toEqual({});
    expect(problems).toEqual([]);
  });

  it('writes the file 0600 and reads it back', async () => {
    expect(await store().update(() => ({ elevenlabs: 'test-key-1' }))).toEqual({ ok: true });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await store().read()).toEqual({ elevenlabs: 'test-key-1' });
  });

  it('answers no keys for a file other users can read, naming the fix but not the content', async () => {
    await writeFile(file, '{"elevenlabs":"test-key-1"}');
    await chmod(file, 0o644);
    expect(await store().read()).toEqual({});
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`chmod 600 ${file}`);
    expect(problems[0]).not.toContain('test-key-1');
  });

  it('answers no keys for a malformed file, without quoting it', async () => {
    await writeFile(file, '{"elevenlabs":"test-key-1"', { mode: 0o600 });
    expect(await store().read()).toEqual({});
    expect(problems).toEqual([`${file} is malformed`]);
  });

  it('loads for an update, telling a missing file from a malformed one', async () => {
    expect(await store().load()).toEqual({ keys: {} });
    await writeFile(file, 'nope test-key-1', { mode: 0o600 });
    expect(await store().load()).toEqual({ problem: `${file} is malformed` });
  });

  it('keeps both of two updates made at once', async () => {
    await Promise.all([
      store().update((keys) => ({ ...keys, elevenlabs: 'test-key-1' })),
      store().update((keys) => ({ ...keys, openrouter: 'test-key-2' })),
    ]);
    expect(await store().read()).toEqual({ elevenlabs: 'test-key-1', openrouter: 'test-key-2' });
  });

  it('leaves a malformed file alone on an update and says why', async () => {
    await writeFile(file, 'nope', { mode: 0o600 });
    expect(await store().update(() => ({ elevenlabs: 'test-key-1' }))).toEqual({ problem: `${file} is malformed` });
    expect(await readFile(file, 'utf8')).toBe('nope');
  });
});
