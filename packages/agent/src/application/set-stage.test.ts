import { describe, expect, it, vi } from 'vitest';
import type { StageKind } from '@tarfa/contracts';
import type { TmuxPort, TmuxSessionInfo } from '../ports/tmux-port.js';
import { setStageFromCli, type SetStageDeps } from './set-stage.js';

const stages = [
  { name: 'In progress', kind: 'active' as StageKind },
  { name: 'In review', kind: 'waiting' as StageKind },
  { name: 'Shipped', kind: 'done' as StageKind },
];

function setup(opts: { ancestor?: boolean; invalid?: string } = {}) {
  const sessions: TmuxSessionInfo[] = [{ name: 'perch-a', startPath: '/w/proj', command: 'claude', createdAt: 0, title: '' }];
  const tmux = {
    listSessions: async () => sessions,
    sessionOfPane: async (pane: string) => (pane === '%1' ? 'perch-a' : null),
    pidOfPane: async (pane: string) => (pane === '%1' ? 100 : null),
  } as unknown as TmuxPort;
  const setStage = vi.fn();
  const stagesFor = vi.fn(async () => stages);
  const onWaitingStaged = vi.fn();
  const onNonWaitingStaged = vi.fn();
  const onStaged = vi.fn();
  const deps: SetStageDeps = {
    tmux,
    ancestry: { isAncestor: async () => opts.ancestor ?? true },
    sessionPrefix: 'perch-',
    stageConfig: { stagesFor, invalidConfig: async () => opts.invalid ?? null },
    status: { setStage },
    onWaitingStaged,
    onNonWaitingStaged,
    onStaged,
  };
  const run = (stage: string, pane = '%1') => setStageFromCli(deps, { pane, pid: 200, stage });
  return { run, setStage, stagesFor, onWaitingStaged, onNonWaitingStaged, onStaged };
}

describe('setStageFromCli', () => {
  it('refuses an unknown name and lists the valid ones', async () => {
    const t = setup();
    const res = await t.run('Nope');
    expect(res).toEqual({ result: 'refused', reason: 'unknown stage "Nope"; valid stages: In progress, In review, Shipped' });
    expect(t.setStage).not.toHaveBeenCalled();
    expect(t.onStaged).not.toHaveBeenCalled();
  });

  it("says when the project's stage file is invalid and the defaults stand in", async () => {
    const res = await setup({ invalid: '/w/proj/.tarfa.json' }).run('Nope');
    expect(res).toEqual({
      result: 'refused',
      reason: 'unknown stage "Nope"; valid stages: In progress, In review, Shipped (/w/proj/.tarfa.json is invalid; using the defaults)',
    });
  });

  it("stores a waiting stage with the list's spelling and marks the turn", async () => {
    const t = setup();
    expect(await t.run(' in REVIEW ')).toEqual({ result: 'set', stage: stages[1] });
    expect(t.stagesFor).toHaveBeenCalledWith('/w/proj');
    expect(t.setStage).toHaveBeenCalledWith('perch-a', { name: 'In review', kind: 'waiting' });
    expect(t.onWaitingStaged).toHaveBeenCalledWith('perch-a');
    expect(t.onNonWaitingStaged).not.toHaveBeenCalled();
    expect(t.onStaged).toHaveBeenCalledWith('perch-a');
  });

  it('sets an active or done stage without marking the turn', async () => {
    const t = setup();
    await t.run('In progress');
    await t.run('shipped');
    expect(t.setStage).toHaveBeenCalledTimes(2);
    expect(t.onWaitingStaged).not.toHaveBeenCalled();
    expect(t.onNonWaitingStaged).toHaveBeenCalledTimes(2);
    expect(t.onStaged).toHaveBeenCalledTimes(2);
  });

  it('refuses outside a workspace', async () => {
    const t = setup();
    expect(await t.run('Shipped', '%9')).toEqual({ result: 'refused', reason: 'not run from a Tarfa workspace' });
    const spoof = setup({ ancestor: false });
    expect(await spoof.run('Shipped')).toEqual({ result: 'refused', reason: 'not run from a Tarfa workspace' });
    expect(t.setStage).not.toHaveBeenCalled();
    expect(spoof.setStage).not.toHaveBeenCalled();
  });
});
