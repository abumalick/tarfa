// One entry of Claude Code's session registry (~/.claude/sessions/<pid>.json), reduced to
// what Tarfa needs: the tmux session it runs in (the join key — a workspace id), the session's
// name, which is the address other Claude Code sessions message it by, and whether it is a
// `claude -p` or SDK run.
export interface ClaudeSessionRef {
  tmuxSession: string;
  address: string;
  print?: true;
}

// A `claude -p` or SDK run registers on the pane of whichever session started it and says
// `kind: "interactive"` like any other; only `entrypoint` differs (`sdk-*` against `cli`).
export function isPrintRun(entrypoint: unknown): boolean {
  return typeof entrypoint === 'string' && entrypoint.startsWith('sdk-');
}

// Validates one registry entry. The registry is undocumented Claude Code internals, so this
// reads defensively and drops anything it cannot both join and label — an entry we cannot
// key on a tmux session could never match a workspace anyway.
export function parseClaudeSession(raw: unknown): ClaudeSessionRef | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { name, tmux, entrypoint } = raw as { name?: unknown; tmux?: unknown; entrypoint?: unknown };
  if (typeof name !== 'string' || name.length === 0) return null;
  if (typeof tmux !== 'string') return null;
  // `tmux` is "<session>:<window>.<pane>"; only the session name is the workspace id.
  const tmuxSession = tmux.split(':')[0] ?? '';
  if (tmuxSession.length === 0) return null;
  return { tmuxSession, address: name, ...(isPrintRun(entrypoint) ? { print: true as const } : {}) };
}
