import { describe, it, expect } from 'vitest';
import type { Workspace, WorkspaceStatus } from '@tarfa/contracts';
import { effectiveStage, homeGroups, needsYou } from './stage-groups';

const stages = [
  { name: 'In progress', kind: 'active' as const },
  { name: 'In review', kind: 'waiting' as const },
  { name: 'Blocked', kind: 'waiting' as const },
  { name: 'Done', kind: 'done' as const },
];
const ws = (id: string, status: WorkspaceStatus, extra: Partial<Workspace> = {}): Workspace => ({
  id,
  name: id,
  machineId: 'm',
  projectPath: 'p',
  command: 'bash',
  createdAt: 0,
  lastActivityAt: 7,
  status,
  ...extra,
});
const stage = (name: string, kind: 'active' | 'waiting' | 'done') => ({ name, kind, since: 1 });
const ids = (gs: { workspace: Workspace }[]) => gs.map((g) => g.workspace.id);
const folded = (h: ReturnType<typeof homeGroups>) => h.folded.map((b) => [b.name, ids(b.groups)]);

describe('effectiveStage', () => {
  it('prefers the workspace stage', () => {
    expect(effectiveStage(ws('a', 'review', { stage: stage('Done', 'done') }))?.name).toBe('Done');
  });
  it('maps legacy statuses', () => {
    expect(effectiveStage(ws('a', 'review'))).toEqual({ name: 'review', kind: 'waiting', since: 7, legacy: 'review' });
    expect(effectiveStage(ws('a', 'blocked'))?.kind).toBe('waiting');
    expect(effectiveStage(ws('a', 'finished'))).toMatchObject({ kind: 'done', legacy: 'finished' });
  });
  it('is undefined otherwise', () => {
    expect(effectiveStage(ws('a', 'working'))).toBeUndefined();
  });
});

describe('needsYou', () => {
  it('is true for needs-feedback and needs-hands unless waiting', () => {
    expect(needsYou(ws('a', 'needs-feedback'))).toBe(true);
    expect(needsYou(ws('a', 'needs-hands'))).toBe(true);
    expect(needsYou(ws('a', 'needs-hands', { waiting: true }))).toBe(false);
    expect(needsYou(ws('a', 'working'))).toBe(false);
  });
});

describe('homeGroups', () => {
  it('keeps a needs-feedback row in needsYou whatever its stage', () => {
    const h = homeGroups([ws('a', 'needs-feedback', { stage: stage('In review', 'waiting'), stages })]);
    expect(ids(h.needsYou)).toEqual(['a']);
    expect(h.folded).toEqual([]);
  });

  it('folds a working row in a waiting stage', () => {
    const h = homeGroups([ws('a', 'working', { stage: stage('In review', 'waiting'), stages })]);
    expect(folded(h)).toEqual([['In review', ['a']]]);
    expect(h.needsYou).toEqual([]);
  });

  it('folds a waiting:true row, not needsYou', () => {
    const h = homeGroups([ws('a', 'needs-feedback', { waiting: true, stage: stage('Blocked', 'waiting'), stages })]);
    expect(h.needsYou).toEqual([]);
    expect(folded(h)).toEqual([['Blocked', ['a']]]);
  });

  it('lifts a whole group when a child needs you under a folded parent', () => {
    const h = homeGroups([
      ws('c', 'needs-feedback', { parentId: 'p' }),
      ws('p', 'working', { stage: stage('In review', 'waiting'), stages }),
    ]);
    expect(h.needsYou.map((g) => [g.workspace.id, g.children.map((c) => c.id)])).toEqual([['p', ['c']]]);
    expect(h.folded).toEqual([]);
  });

  it('folds a legacy status by its name and mapped kind', () => {
    const h = homeGroups([ws('a', 'review'), ws('b', 'finished')]);
    expect(folded(h)).toEqual([['review', ['a']], ['finished', ['b']]]);
  });

  it('puts a row with no stage, or an active stage, in active', () => {
    const h = homeGroups([ws('a', 'working'), ws('b', 'idle', { stage: stage('In progress', 'active'), stages })]);
    expect(ids(h.active)).toEqual(['a', 'b']);
  });

  it('orders buckets waiting before done, then by the list index, then first appearance', () => {
    const h = homeGroups([
      ws('d', 'idle', { stage: stage('Done', 'done'), stages }),
      ws('b', 'idle', { stage: stage('Blocked', 'waiting'), stages }),
      ws('r', 'idle', { stage: stage('In review', 'waiting'), stages }),
      ws('l1', 'review'),
      ws('l2', 'blocked'),
    ]);
    expect(folded(h)).toEqual([['In review', ['r']], ['Blocked', ['b']], ['review', ['l1']], ['blocked', ['l2']], ['Done', ['d']]]);
  });

  it('keeps list order within a bucket and excludes parked', () => {
    const r = (id: string) => ws(id, 'idle', { stage: stage('In review', 'waiting'), stages });
    const h = homeGroups([r('x'), ws('pk', 'parked'), r('y'), r('z')]);
    expect(folded(h)).toEqual([['In review', ['x', 'y', 'z']]]);
  });
});
