import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// Found as the launcher and the `tarfa` wrapper find it: the usual places, then PATH.
export function findMise(home: string, pathVar: string | undefined, exists: (path: string) => boolean = existsSync): string | null {
  const candidates = [join(home, '.local', 'bin', 'mise'), '/opt/homebrew/bin/mise', '/usr/local/bin/mise', ...(pathVar ?? '').split(delimiter).filter(Boolean).map((dir) => join(dir, 'mise'))];
  return candidates.find(exists) ?? null;
}

// npm links the package's bin into <install>/bin; aube (a newer mise's npm backend) installs it
// under <install>/node_modules, whose .bin/tarfa is a shell script node cannot run, so take the
// package's entry there. The launcher and the `tarfa` wrapper try the same two paths.
export function findInstalledCli(install: string, exists: (path: string) => boolean = existsSync): string | null {
  if (!install) return null;
  return [join(install, 'bin', 'tarfa'), join(install, 'node_modules', '@tarfa', 'cli', 'dist', 'cli.js')].find(exists) ?? null;
}

// Every call runs from $HOME, so no folder's mise.toml (untrusted, or pinning another node) takes part.
export function miseCli(home: string) {
  const run = async (mise: string, args: string[], timeout: number): Promise<string> => {
    try {
      return (await exec(mise, ['--cd', home, ...args], { timeout })).stdout.trim();
    } catch (err) {
      const stderr = String((err as { stderr?: string }).stderr ?? '').trim();
      throw new Error(`mise ${args.join(' ')} failed${stderr ? `: ${stderr.split('\n').slice(-3).join(' ')}` : ''}`);
    }
  };
  return {
    install: async (mise: string, version: string) => void (await run(mise, ['use', '-g', `npm:@tarfa/cli@${version}`], 600_000)),
    async locate(mise: string, version: string): Promise<{ node: string; cli: string }> {
      const install = await run(mise, ['where', `npm:@tarfa/cli@${version}`], 60_000);
      const nodeHome = await run(mise, ['where', 'node'], 60_000);
      const cli = findInstalledCli(install);
      const node = join(nodeHome, 'bin', 'node');
      if (!cli) throw new Error(`mise knows no install of @tarfa/cli ${version} with a bin/tarfa or node_modules/@tarfa/cli/dist/cli.js`);
      if (!nodeHome || !existsSync(node)) throw new Error('mise knows no node');
      return { node, cli };
    },
    apply: (node: string, cli: string) =>
      new Promise<number>((resolve, reject) => {
        const child = spawn(node, [cli, 'apply'], { stdio: 'inherit' });
        child.on('error', reject);
        child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
      }),
  };
}
