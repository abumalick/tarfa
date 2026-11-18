import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { packageRoot } from './package-root';

export const OPEN_SCRIPT = 'tarfa-open.sh';

// Every workspace's BROWSER (see TmuxAdapter's sessionEnv). Rewritten at each startup so it always
// names this agent's hooks port and matches the running release; renamed into place so a tool
// starting it meanwhile never reads half of it.
export async function writeOpenScript(stateDir: string, port: number): Promise<string> {
  const source = await readFile(join(packageRoot(), 'src', 'hooks', OPEN_SCRIPT), 'utf8');
  const path = join(stateDir, OPEN_SCRIPT);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, source.replace('__TARFA_HOOKS_PORT__', String(port)), { encoding: 'utf8', mode: 0o755 });
  await chmod(temporary, 0o755);
  await rename(temporary, path);
  return path;
}
