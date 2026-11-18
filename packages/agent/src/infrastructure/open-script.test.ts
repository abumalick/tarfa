import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { workspaceSessionEnv, writeOpenScript } from './open-script';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('writeOpenScript', () => {
  it('writes an executable tarfa-open.sh that names the hooks port', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tarfa-open-'));
    dirs.push(dir);
    const path = await writeOpenScript(dir, 8799);
    expect(path).toBe(join(dir, 'tarfa-open.sh'));
    const text = await readFile(path, 'utf8');
    expect(text).toContain('port=8799\n');
    expect(text).not.toContain('__TARFA_HOOKS_PORT__');
    expect(text).toContain(`token_file='${dir}/token'\n`);
    expect((await stat(path)).mode & 0o777).toBe(0o755);
  });

  it('gives workspaces the opener once the agent has written it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tarfa-open-'));
    dirs.push(dir);
    expect(workspaceSessionEnv(dir)).toEqual({});
    await writeOpenScript(dir, 8799);
    expect(workspaceSessionEnv(dir)).toEqual({ sessionEnv: { BROWSER: join(dir, 'tarfa-open.sh') } });
  });
});
