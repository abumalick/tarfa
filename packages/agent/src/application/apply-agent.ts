// `tarfa apply`: after the package is upgraded, bring the service in line with it and prove the
// agent is back. One ok/failed line per step, stopping at the first failure.

export interface ApplyEffects {
  // Why apply cannot run here (not set up, state not moved), or null.
  blocker(): Promise<string | null>;
  // Each returns whether it changed anything; they leave what was there if they fail.
  writeLauncher(): Promise<boolean>;
  writeUnit(): Promise<boolean>;
  // The `tarfa` wrapper and the `perch` link in ~/.local/bin; `notes` are what it left alone.
  writeCliWrapper(): Promise<{ changed: boolean; notes: string[] }>;
  // `codex`: Codex's hooks were written too, and need trusting again.
  installHooks(): Promise<{ changed: boolean; codex: boolean }>;
  // Taken just before the restart; `agentLog` returns only what the agent printed after it.
  markLog(): Promise<unknown>;
  restart(): Promise<string>;
  checkListener(port: number): Promise<boolean>;
  agentLog(mark: unknown): Promise<string>;
  sleep(ms: number): Promise<void>;
}

export interface ApplyOptions {
  phonePort: number;
  attempts?: number;
  intervalMs?: number;
  codexNote: string;
}

const NO_PHONE_PORT = /^.*no phone port.*$/m;

export async function runApply(effects: ApplyEffects, options: ApplyOptions): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = [];
  const attempts = options.attempts ?? 20;
  const intervalMs = options.intervalMs ?? 500;
  const fail = (step: string, why: string) => {
    lines.push(`failed: ${step}: ${why}`);
    return { ok: false, lines };
  };
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

  try {
    const blocker = await effects.blocker();
    if (blocker) return fail('check', blocker);
  } catch (err) {
    return fail('check', message(err));
  }
  try {
    lines.push((await effects.writeLauncher()) ? 'ok: launcher written' : 'ok: launcher already current');
  } catch (err) {
    return fail('launcher', message(err));
  }
  try {
    lines.push((await effects.writeUnit()) ? 'ok: service definition written, daemon reloaded' : 'ok: service definition already current');
  } catch (err) {
    return fail('service definition', message(err));
  }
  try {
    const hooks = await effects.installHooks();
    lines.push(hooks.changed ? 'ok: hooks installed' : 'ok: hooks already current');
    if (hooks.changed && hooks.codex) lines.push(`note: ${options.codexNote}`);
  } catch (err) {
    return fail('hooks', message(err));
  }
  let mark: unknown;
  try {
    mark = await effects.markLog();
    lines.push(`ok: restarted (${await effects.restart()})`);
  } catch (err) {
    return fail('restart', message(err));
  }

  let answered = false;
  for (let i = 0; i < attempts && !answered; i++) {
    if (i > 0) await effects.sleep(intervalMs);
    answered = await effects.checkListener(options.phonePort).catch(() => false);
  }
  if (!answered) {
    const refusal = NO_PHONE_PORT.exec(await effects.agentLog(mark).catch(() => ''))?.[0];
    return fail('phone port', refusal ?? `nothing answers a WebSocket upgrade on 127.0.0.1:${options.phonePort}`);
  }
  lines.push(`ok: the phone port answers on 127.0.0.1:${options.phonePort}`);

  let log = '';
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await effects.sleep(intervalMs);
    log = await effects.agentLog(mark).catch(() => '');
    if (log.includes('phones on') || NO_PHONE_PORT.test(log)) break;
  }
  if (!log.includes('phones on')) return fail('log', NO_PHONE_PORT.exec(log)?.[0] ?? 'the agent log has no "phones on" line since the restart');
  lines.push('ok: the log shows phones on');
  // Last, so an I/O failure on ~/.local/bin can never stop the restart a new launcher or unit needs.
  try {
    const cli = await effects.writeCliWrapper();
    lines.push(cli.changed ? 'ok: tarfa command wrapper written' : 'ok: tarfa command wrapper already current');
    lines.push(...cli.notes);
  } catch (err) {
    return fail('tarfa command wrapper', message(err));
  }
  return { ok: true, lines };
}
