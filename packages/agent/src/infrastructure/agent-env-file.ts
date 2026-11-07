import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { resolveAgentEnvPath } from '../application/agent-env-location';
import type { AgentEnvPort } from '../ports/agent-env-port';
import { installKind, type InstallKind } from './package-root';

const exec = promisify(execFile);

// The main checkout of a source install, where deploy/run-agent.sh sources deploy/agent.env from
// even when a worktree is being served; null for a package install, which must not run git.
export async function mainCheckout(kind: InstallKind = installKind()): Promise<string | null> {
  if (kind === 'package') return null;
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    const { stdout } = await exec('git', ['-C', here, 'rev-parse', '--path-format=absolute', '--git-common-dir']);
    return dirname(stdout.trim());
  } catch {
    return resolve(here, '..', '..', '..', '..');
  }
}

export async function locateAgentEnv(env: NodeJS.ProcessEnv, home: string, kind: InstallKind = installKind()): Promise<string> {
  return resolveAgentEnvPath({ env, home, checkout: await mainCheckout(kind), exists: existsSync });
}

export function agentEnvFile(path: string, now: () => Date = () => new Date()): AgentEnvPort {
  return {
    path,
    read: async () => {
      try {
        return await readFile(path, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`no agent config at ${path}: set the agent up first (docs/DEPLOY.md), or set TARFA_AGENT_ENV`);
        }
        throw err;
      }
    },
    write: async (text) => {
      let backup: string | null = `${path}.bak-${now().toISOString().replace(/[:.]/g, '-')}`;
      try {
        await copyFile(path, backup);
        await chmod(backup, 0o600);
      } catch (err) {
        // A machine being set up has no file to back up yet.
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        backup = null;
      }
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, text, { mode: 0o600 });
      // The mode above applies only when the file is created.
      await chmod(path, 0o600);
      return backup;
    },
  };
}
