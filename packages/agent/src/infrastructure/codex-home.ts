import { join } from 'node:path';
import { loginShell } from './codex-versions';

const MARK = 'codex-home=';

// Where Codex keeps its hooks.json and app-server socket: CODEX_HOME when set and not empty (as
// Codex reads it), else ~/.codex. A service has no shell profile of its own, so a value missing
// from its environment is asked of the login shell, the one `codex` the panes run sees.
export async function resolveCodexHome(
  env: Record<string, string | undefined>,
  home: string,
  run: (script: string) => Promise<string> = loginShell(),
): Promise<string> {
  if (env.CODEX_HOME) return env.CODEX_HOME;
  const out = await run(`printf '\\n${MARK}%s\\n' "\${CODEX_HOME-}"`).catch(() => '');
  const value = out
    .split('\n')
    .reverse()
    .find((line) => line.startsWith(MARK))
    ?.slice(MARK.length);
  return value || join(home, '.codex');
}
