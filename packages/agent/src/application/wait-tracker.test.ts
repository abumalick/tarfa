import { describe, expect, it } from 'vitest';
import type { Workspace } from '@tarfa/contracts';
import { WAIT_HOLD_MS, WAIT_SETTLE_MS, WAIT_STARTING_MS, WaitTracker } from './wait-tracker';

const T0 = 1_800_000_000_000;

function ws(id: string, status: Workspace['status'], extra: Partial<Workspace> = {}): Workspace {
  return {
    machineId: 'm',
    id,
    name: id,
    projectPath: '/p',
    command: 'claude',
    createdAt: T0 - 3_600_000,
    lastActivityAt: T0,
    status,
    ...extra,
  };
}

describe('WaitTracker', () => {
  it('keeps waiting while the workspace works', () => {
    const t = new WaitTracker(['a'], T0);
    expect(t.observe([ws('a', 'working')], T0)).toEqual([]);
    expect(t.observe([ws('a', 'working')], T0 + 3_600_000)).toEqual([]);
  });

  // A close, a crash or a lost tmux server: nothing will ever change, so there is nothing to hold for.
  it('reports a workspace that is gone at once, even on the first look', () => {
    expect(new WaitTracker(['a'], T0).observe([], T0)).toEqual([{ id: 'a', state: 'gone' }]);
  });

  it('reports a parked workspace at once: it makes no progress on its own', () => {
    expect(new WaitTracker(['a'], T0).observe([ws('a', 'parked')], T0)).toEqual([{ id: 'a', state: 'parked' }]);
  });

  // The stop must last past the gap between a turn's Stop and a queued message's prompt.
  it('reports a stop seen after working once it has held', () => {
    const t = new WaitTracker(['a'], T0);
    t.observe([ws('a', 'working')], T0);
    expect(t.observe([ws('a', 'needs-feedback')], T0 + 2000)).toEqual([]);
    expect(t.observe([ws('a', 'needs-feedback')], T0 + 2000 + WAIT_HOLD_MS)).toEqual([{ id: 'a', state: 'needs-feedback' }]);
  });

  it('starts the hold over when the workspace goes back to work', () => {
    const t = new WaitTracker(['a'], T0);
    t.observe([ws('a', 'working')], T0);
    t.observe([ws('a', 'needs-feedback')], T0 + 2000);
    t.observe([ws('a', 'working')], T0 + 2000 + WAIT_HOLD_MS);
    expect(t.observe([ws('a', 'needs-feedback')], T0 + 2000 + 2 * WAIT_HOLD_MS)).toEqual([]);
  });

  // Right after a `tarfa send` the old state lingers until the recipient's turn starts.
  it('does not report a stop already there when it wakes up within the settle window', () => {
    const t = new WaitTracker(['a'], T0);
    const stopped = ws('a', 'working', { waitingOn: 'parent' });
    expect(t.observe([stopped], T0)).toEqual([]);
    expect(t.observe([stopped], T0 + WAIT_SETTLE_MS - 1)).toEqual([]);
    expect(t.observe([ws('a', 'working')], T0 + WAIT_SETTLE_MS)).toEqual([]);
  });

  // The orchestrator may start waiting after the child stopped: that stop must not be lost.
  it('reports a stop already there once the settle window has passed', () => {
    const t = new WaitTracker(['a'], T0);
    const stopped = ws('a', 'working', { waitingOn: 'parent' });
    t.observe([stopped], T0);
    expect(t.observe([stopped], T0 + WAIT_SETTLE_MS)).toEqual([{ id: 'a', state: 'needs-orchestrator' }]);
  });

  // No hook has fired yet, so a child still starting up reads idle.
  it('treats idle on a young workspace as still starting', () => {
    const t = new WaitTracker(['a'], T0);
    const young = ws('a', 'idle', { createdAt: T0 });
    expect(t.observe([young], T0)).toEqual([]);
    expect(t.observe([young], T0 + WAIT_SETTLE_MS)).toEqual([]);
    expect(t.observe([young], T0 + WAIT_STARTING_MS - 1)).toEqual([]);
  });

  // One stuck before its first hook (a trust prompt, say) must not hang the wait for good.
  it('reports idle once the workspace is past its startup', () => {
    const t = new WaitTracker(['a'], T0);
    const young = ws('a', 'idle', { createdAt: T0 });
    expect(t.observe([young], T0 + WAIT_STARTING_MS - 1)).toEqual([]);
    expect(t.observe([young], T0 + WAIT_STARTING_MS)).toEqual([{ id: 'a', state: 'idle' }]);
  });

  // A child that messaged its parent and is still thinking reads the same until its next tool.
  it('gives needs-orchestrator the settle window even after working', () => {
    const t = new WaitTracker(['a'], T0);
    const messaged = ws('a', 'working', { waitingOn: 'parent' });
    t.observe([ws('a', 'working')], T0);
    expect(t.observe([messaged], T0 + 2000)).toEqual([]);
    expect(t.observe([messaged], T0 + 2000 + WAIT_SETTLE_MS - 1)).toEqual([]);
    expect(t.observe([messaged], T0 + 2000 + WAIT_SETTLE_MS)).toEqual([{ id: 'a', state: 'needs-orchestrator' }]);
  });

  it('reports every named workspace that stopped, and only those', () => {
    const t = new WaitTracker(['a', 'b', 'c'], T0);
    const out = t.observe([ws('a', 'parked'), ws('b', 'working'), ws('other', 'parked')], T0);
    expect(out).toEqual([
      { id: 'a', state: 'parked' },
      { id: 'c', state: 'gone' },
    ]);
  });
});
