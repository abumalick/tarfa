import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
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
    await store().save({ elevenlabs: 'test-key-1' });
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
});
