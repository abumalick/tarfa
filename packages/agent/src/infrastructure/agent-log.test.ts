import { afterEach, describe, expect, it } from 'vitest';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentLog } from './agent-log';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('agentLog', () => {
  it('asks the journal for the user unit since the second of the mark', async () => {
    const calls: string[][] = [];
    const log = agentLog({ home: '/h', platform: 'linux', now: () => 1_700_000_123_456, run: async (command, args) => (calls.push([command, ...args]), 'tarfa agent: phones on 127.0.0.1:1\n') });
    const mark = await log.mark();
    expect(await log.since(mark)).toBe('tarfa agent: phones on 127.0.0.1:1\n');
    expect(calls).toEqual([['journalctl', '--user', '-u', 'tarfa-agent', '--since=@1700000123', '--no-pager', '-o', 'cat']]);
  });

  it('reads the plist\'s log files from their size at the mark, so older lines never count', async () => {
    const home = await mkdtemp(join(tmpdir(), 'tarfa-agent-log-'));
    dirs.push(home);
    const out = join(home, '.tarfa', 'agent.log');
    const err = join(home, '.tarfa', 'agent.err.log');
    await mkdir(join(home, 'Library', 'LaunchAgents'), { recursive: true });
    await mkdir(join(home, '.tarfa'));
    await writeFile(
      join(home, 'Library', 'LaunchAgents', 'app.tarfa.agent.plist'),
      `<plist><dict><key>StandardOutPath</key><string>${out}</string>\n<key>StandardErrorPath</key><string>${err}</string></dict></plist>`,
    );
    await writeFile(out, 'tarfa agent: phones on 127.0.0.1:1 (the previous run)\n');
    await writeFile(err, 'old error\n');
    const log = agentLog({ home, platform: 'darwin' });
    const mark = await log.mark();
    expect(await log.since(mark)).toBe('');
    await appendFile(out, 'tarfa agent: version 2\n');
    await appendFile(err, 'tarfa agent: no phone port: x\n');
    expect(await log.since(mark)).toBe('tarfa agent: version 2\ntarfa agent: no phone port: x\n');
  });

  it('takes a log that shrank for a rotated one: all of it is new', async () => {
    const home = await mkdtemp(join(tmpdir(), 'tarfa-agent-log-'));
    dirs.push(home);
    const out = join(home, 'out.log');
    await mkdir(join(home, 'Library', 'LaunchAgents'), { recursive: true });
    await writeFile(join(home, 'Library', 'LaunchAgents', 'app.tarfa.agent.plist'), `<key>StandardOutPath</key><string>${out}</string>`);
    await writeFile(out, 'a long line from before the rotation\n');
    const log = agentLog({ home, platform: 'darwin' });
    const mark = await log.mark();
    await writeFile(out, 'phones on\n');
    expect(await log.since(mark)).toBe('phones on\n');
  });
});
