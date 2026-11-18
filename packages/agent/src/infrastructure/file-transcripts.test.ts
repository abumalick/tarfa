import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTranscripts } from './file-transcripts';

const SESSION = '0a1b2c3d-4e5f-6789-abcd-ef0123456789';
const reply = (id: string, text: string) =>
  JSON.stringify({ type: 'assistant', message: { id, stop_reason: 'end_turn', content: [{ type: 'text', text }] } });

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tarfa-transcripts-'));
  await mkdir(join(root, '-home-foo-other'));
  await mkdir(join(root, '-home-foo-project'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('FileTranscripts', () => {
  it('finds the session in whichever project folder holds it and reads its last reply', async () => {
    await writeFile(join(root, '-home-foo-project', `${SESSION}.jsonl`), `${reply('m1', 'Old.')}\n${reply('m2', 'Réponse, صحيح.')}\n`);
    expect(await new FileTranscripts(root).lastReply(SESSION)).toBe('Réponse, صحيح.');
  });

  it('reads only the tail of a long transcript, skipping the line it starts inside', async () => {
    const filler = reply('m0', 'x'.repeat(5000));
    await writeFile(join(root, '-home-foo-project', `${SESSION}.jsonl`), `${filler}\n${reply('m1', 'Tail é.')}\n`);
    expect(await new FileTranscripts(root, 1000).lastReply(SESSION)).toBe('Tail é.');
  });

  it('caps a long reply', async () => {
    await writeFile(join(root, '-home-foo-project', `${SESSION}.jsonl`), `${reply('m1', 'y'.repeat(70_000))}\n`);
    expect(await new FileTranscripts(root).lastReply(SESSION)).toHaveLength(64_000);
  });

  it('answers null for an unknown session, a missing folder, or an id that is not a plain session id', async () => {
    await writeFile(join(root, 'evil.jsonl'), `${reply('m1', 'Outside.')}\n`);
    expect(await new FileTranscripts(root).lastReply(SESSION)).toBeNull();
    expect(await new FileTranscripts(join(root, 'nope')).lastReply(SESSION)).toBeNull();
    expect(await new FileTranscripts(join(root, '-home-foo-project')).lastReply('../evil')).toBeNull();
  });
});
