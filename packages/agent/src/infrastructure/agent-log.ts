import { open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { systemRun, type Run } from './service-install';

export interface AgentLog {
  // Taken just before a restart.
  mark(): Promise<unknown>;
  // What the agent printed after the mark, and nothing from before it.
  since(mark: unknown): Promise<string>;
}

interface FileMark {
  [path: string]: number;
}

async function sizeOf(path: string): Promise<number> {
  return stat(path).then((s) => s.size, () => 0);
}

async function readFrom(path: string, offset: number): Promise<string> {
  const size = await sizeOf(path);
  // A file that shrank was rotated: all of it is new.
  const from = size < offset ? 0 : offset;
  if (size === from) return '';
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(size - from);
    await handle.read(buffer, 0, buffer.length, from);
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

// The agent's own output: the journal of its user unit under systemd, and under launchd the two
// files its plist names, from the size they had at the mark.
export function agentLog(options: { home: string; platform?: NodeJS.Platform; run?: Run; now?: () => number }): AgentLog {
  const run = options.run ?? systemRun;
  const now = options.now ?? Date.now;
  if ((options.platform ?? process.platform) !== 'darwin') {
    return {
      mark: async () => Math.floor(now() / 1000),
      since: (mark) => run('journalctl', ['--user', '-u', 'tarfa-agent', `--since=@${String(mark)}`, '--no-pager', '-o', 'cat']),
    };
  }
  const plist = join(options.home, 'Library', 'LaunchAgents', 'app.tarfa.agent.plist');
  const files = async () => {
    const text = await readFile(plist, 'utf8');
    return ['StandardOutPath', 'StandardErrorPath'].flatMap((key) => {
      const path = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(text)?.[1];
      return path ? [path] : [];
    });
  };
  return {
    mark: async () => {
      const marks: FileMark = {};
      for (const path of await files()) marks[path] = await sizeOf(path);
      return marks;
    },
    since: async (mark) => {
      const marks = mark as FileMark;
      const parts: string[] = [];
      for (const path of await files()) parts.push(await readFrom(path, marks[path] ?? 0));
      return parts.join('');
    },
  };
}
