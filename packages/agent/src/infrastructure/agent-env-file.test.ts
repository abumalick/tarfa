import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentEnvFile, locateAgentEnv } from './agent-env-file';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('agentEnvFile', () => {
  // agent.env holds TARFA_TOKEN. A copy of the example keeps the checkout's 0664, and writeFile's
  // mode applies only to a file it creates.
  it('leaves an existing agent.env, and its backup, readable by its owner alone', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tarfa-agent-env-'));
    dirs.push(dir);
    const path = join(dir, 'agent.env');
    await writeFile(path, 'TARFA_TOKEN=t\n');
    await chmod(path, 0o664);
    const backup = await agentEnvFile(path).write('TARFA_TOKEN=t\nTARFA_PHONE_ADDRESSES=wss://box.example.ts.net\n');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(backup!)).mode & 0o777).toBe(0o600);
    expect(await readdir(dir)).toHaveLength(2);
  });

  it('creates a missing agent.env, owner-only, with no backup', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tarfa-agent-env-'));
    dirs.push(dir);
    const path = join(dir, 'agent.env');
    expect(await agentEnvFile(path).write('TARFA_TOKEN=t\n')).toBeNull();
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readdir(dir)).toEqual(['agent.env']);
  });
});

describe('locateAgentEnv', () => {
  it('names ~/.tarfa/agent.env for a package install, present or not, and TARFA_AGENT_ENV over it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'tarfa-agent-env-home-'));
    dirs.push(home);
    expect(await locateAgentEnv({}, home, 'package')).toBe(join(home, '.tarfa', 'agent.env'));
    expect(await locateAgentEnv({ TARFA_AGENT_ENV: '/etc/a.env' }, home, 'package')).toBe('/etc/a.env');
  });

  it('prefers ~/.tarfa/agent.env to the checkout\'s once it exists, for a source install', async () => {
    const home = await mkdtemp(join(tmpdir(), 'tarfa-agent-env-home-'));
    dirs.push(home);
    expect(await locateAgentEnv({}, home, 'clone')).toMatch(/\/deploy\/agent\.env$/);
    await mkdir(join(home, '.tarfa'));
    await writeFile(join(home, '.tarfa', 'agent.env'), 'TARFA_TOKEN=t\n');
    expect(await locateAgentEnv({}, home, 'clone')).toBe(join(home, '.tarfa', 'agent.env'));
  });
});
