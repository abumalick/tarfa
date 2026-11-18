import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { TranscriptsPort } from '../ports/transcripts-port';
import { lastReplyInTranscript } from '../application/transcript-reply';
import { MAX_REPLY_CHARS } from '../application/last-replies';

const SESSION_ID = /^[0-9A-Za-z-]+$/;
const TAIL_BYTES = 4 * 1024 * 1024;

// Claude Code's transcripts (default ~/.claude/projects/<project>/<session id>.jsonl), read-only.
// Only the tail is read: a transcript grows to tens of megabytes, and the reply is near its end.
export class FileTranscripts implements TranscriptsPort {
  constructor(
    private readonly projectsDir: string,
    private readonly tailBytes = TAIL_BYTES,
  ) {}

  async lastReply(claudeSessionId: string): Promise<string | null> {
    if (!SESSION_ID.test(claudeSessionId)) return null;
    try {
      const path = await this.find(`${claudeSessionId}.jsonl`);
      if (!path) return null;
      const lines = await this.tailLines(path);
      return lastReplyInTranscript(lines)?.slice(0, MAX_REPLY_CHARS) ?? null;
    } catch {
      return null;
    }
  }

  private async find(file: string): Promise<string | null> {
    for (const project of await readdir(this.projectsDir, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      const entries = await readdir(join(this.projectsDir, project.name)).catch(() => [] as string[]);
      if (entries.includes(file)) return join(this.projectsDir, project.name, file);
    }
    return null;
  }

  private async tailLines(path: string): Promise<string[]> {
    const handle = await open(path, 'r');
    try {
      const { size } = await handle.stat();
      const start = Math.max(0, size - this.tailBytes);
      const buffer = Buffer.alloc(size - start);
      await handle.read(buffer, 0, buffer.length, start);
      const lines = buffer.toString('utf8').split('\n');
      // A window that starts mid-file starts mid-line, maybe mid-character.
      return start > 0 ? lines.slice(1) : lines;
    } finally {
      await handle.close();
    }
  }
}
