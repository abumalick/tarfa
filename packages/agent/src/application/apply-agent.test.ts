import { describe, expect, it } from 'vitest';
import { runApply, type ApplyEffects } from './apply-agent';

function fakes(over: Partial<ApplyEffects> = {}, state: { launcher: string; unit: string } = { launcher: 'old-launcher', unit: 'old-unit' }) {
  const calls: string[] = [];
  const effects: ApplyEffects = {
    blocker: async () => null,
    // What the real ones guarantee: a failure leaves the previous file.
    writeLauncher: async () => {
      calls.push('launcher');
      const changed = state.launcher !== 'new-launcher';
      state.launcher = 'new-launcher';
      return changed;
    },
    writeUnit: async () => {
      calls.push('unit');
      const changed = state.unit !== 'new-unit';
      state.unit = 'new-unit';
      return { changed, kept: null };
    },
    writeCliWrapper: async () => (calls.push('cli'), { changed: false, notes: [] }),
    installHooks: async () => (calls.push('hooks'), { changed: false, codex: false }),
    markLog: async () => (calls.push('mark'), 7),
    restart: async () => (calls.push('restart'), 'systemctl --user restart tarfa-agent'),
    checkListener: async () => (calls.push('listener'), true),
    agentLog: async (mark) => (calls.push(`log since ${String(mark)}`), 'tarfa agent: phones on 127.0.0.1:8797\n'),
    sleep: async () => undefined,
    ...over,
  };
  return { effects, calls, state };
}
const OPTIONS = { phonePort: 8797, codexNote: 'trust the hooks', attempts: 3, intervalMs: 1 };

describe('runApply', () => {
  it('runs every step in order, one ok line each', async () => {
    const { effects, calls } = fakes();
    const result = await runApply(effects, OPTIONS);
    expect(result.ok).toBe(true);
    expect(calls).toEqual(['launcher', 'unit', 'hooks', 'mark', 'restart', 'listener', 'log since 7', 'cli']);
    expect(result.lines).toEqual([
      'ok: launcher written',
      'ok: service definition written, daemon reloaded',
      'ok: hooks already current',
      'ok: restarted (systemctl --user restart tarfa-agent)',
      'ok: the phone port answers on 127.0.0.1:8797',
      'ok: the log shows phones on',
      'ok: tarfa command wrapper already current',
    ]);
  });

  it('restarts and checks the agent before it touches ~/.local/bin, so a wrapper failure cannot stop a restart', async () => {
    const { effects, calls } = fakes({ writeCliWrapper: async () => { throw new Error('EACCES'); } });
    const result = await runApply(effects, OPTIONS);
    expect(result.ok).toBe(false);
    expect(result.lines.at(-1)).toBe('failed: tarfa command wrapper: EACCES');
    expect(calls).toContain('restart');
    expect(result.lines).toContain('ok: the log shows phones on');
  });

  it('says what was already current', async () => {
    const { effects } = fakes({}, { launcher: 'new-launcher', unit: 'new-unit' });
    const lines = (await runApply(effects, OPTIONS)).lines;
    expect(lines.slice(0, 2)).toEqual(['ok: launcher already current', 'ok: service definition already current']);
  });

  it('prints the Codex re-trust line only when the hooks changed and Codex got them', async () => {
    const changed = fakes({ installHooks: async () => ({ changed: true, codex: true }) });
    expect((await runApply(changed.effects, OPTIONS)).lines).toContain('note: trust the hooks');
    const claudeOnly = fakes({ installHooks: async () => ({ changed: true, codex: false }) });
    expect((await runApply(claudeOnly.effects, OPTIONS)).lines.join('\n')).not.toContain('trust the hooks');
    const same = fakes({ installHooks: async () => ({ changed: false, codex: true }) });
    expect((await runApply(same.effects, OPTIONS)).lines.join('\n')).not.toContain('trust the hooks');
  });

  it('stops at a failed restart, reports that step, and leaves the new launcher and unit as written', async () => {
    const { effects, calls, state } = fakes({
      restart: async () => {
        throw new Error('systemctl --user restart tarfa-agent failed: Unit not found');
      },
    });
    const result = await runApply(effects, OPTIONS);
    expect(result.ok).toBe(false);
    expect(result.lines.at(-1)).toBe('failed: restart: systemctl --user restart tarfa-agent failed: Unit not found');
    expect(calls).not.toContain('listener');
    expect(state).toEqual({ launcher: 'new-launcher', unit: 'new-unit' });
  });

  it('leaves the previous launcher and unit, and goes no further, when the launcher cannot be written', async () => {
    const { effects, calls, state } = fakes({
      writeLauncher: async () => {
        throw new Error('EACCES');
      },
    });
    const result = await runApply(effects, OPTIONS);
    expect(result).toEqual({ ok: false, lines: ['failed: launcher: EACCES'] });
    expect(calls).toEqual([]);
    expect(state).toEqual({ launcher: 'old-launcher', unit: 'old-unit' });
  });

  it('does not restart when the unit cannot be written or the manager cannot be reached', async () => {
    const { effects, calls } = fakes({
      writeUnit: async () => {
        throw new Error('systemctl --user cannot reach your user manager');
      },
    });
    const result = await runApply(effects, OPTIONS);
    expect(result.ok).toBe(false);
    expect(result.lines.at(-1)).toMatch(/^failed: service definition: systemctl --user cannot reach/);
    expect(calls).not.toContain('restart');
  });

  it('refuses a machine that is not set up before changing anything', async () => {
    const { effects, calls } = fakes({ blocker: async () => 'no agent config: run tarfa setup' });
    expect(await runApply(effects, OPTIONS)).toEqual({ ok: false, lines: ['failed: check: no agent config: run tarfa setup'] });
    expect(calls).toEqual([]);
  });

  it('polls a bounded number of times for the phone port, then fails with the agent\'s own no-phone-port line', async () => {
    let tries = 0;
    const { effects } = fakes({
      checkListener: async () => (tries++, false),
      agentLog: async () => 'tarfa agent: no phone port: 127.0.0.1:8797 EADDRINUSE; set TARFA_PHONE_PORT in agent.env\n',
    });
    const result = await runApply(effects, OPTIONS);
    expect(tries).toBe(3);
    expect(result.ok).toBe(false);
    expect(result.lines.at(-1)).toBe('failed: phone port: tarfa agent: no phone port: 127.0.0.1:8797 EADDRINUSE; set TARFA_PHONE_PORT in agent.env');
  });

  it('fails the log step when no "phones on" line appeared since the restart, even though the port answers', async () => {
    const { effects } = fakes({ agentLog: async () => 'tarfa agent: version 1.2.3\n' });
    const result = await runApply(effects, OPTIONS);
    expect(result.ok).toBe(false);
    expect(result.lines.at(-1)).toMatch(/^failed: log: .*phones on/);
  });

  it('passes the mark taken before the restart to every log read, so older lines never count', async () => {
    const order: string[] = [];
    const { effects } = fakes({
      markLog: async () => (order.push('mark'), 'M'),
      restart: async () => (order.push('restart'), 'r'),
      agentLog: async (mark) => (order.push(`log:${String(mark)}`), 'phones on'),
    });
    await runApply(effects, OPTIONS);
    expect(order).toEqual(['mark', 'restart', 'log:M']);
  });
});
