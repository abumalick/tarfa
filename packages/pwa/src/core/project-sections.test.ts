import { describe, it, expect } from 'vitest';
import type { Workspace, WorkspaceStatus } from '@tarfa/contracts';
import { homeSections, listOrder, projectSections } from './project-sections';

const ws = (id: string, status: WorkspaceStatus, projectPath: string, extra: Partial<Workspace> = {}): Workspace => ({
  id,
  name: id,
  machineId: 'm',
  projectPath,
  command: 'bash',
  createdAt: 0,
  lastActivityAt: 0,
  status,
  ...extra,
});

const labelOf = (w: Workspace) => w.projectPath;

describe('listOrder', () => {
  const done = { stage: { name: 'Done', kind: 'done' as const, since: 1 } };
  const list = [
    ws('a1', 'needs-feedback', 'a'),
    ws('b1', 'idle', 'b', done),
    ws('a2', 'working', 'a'),
    ws('b2', 'working', 'b'),
    ws('p', 'parked', 'a'),
  ];

  it('reads needs-you, then the active rows, then the folded stages, then parked, when not grouped', () => {
    expect(listOrder(list, null).map((w) => w.id)).toEqual(['a1', 'a2', 'b2', 'b1', 'p']);
  });

  it('walks each parent then its children', () => {
    const nested = [ws('c', 'needs-feedback', 'a', { parentId: 'q' }), ws('q', 'working', 'a'), ws('i', 'idle', 'a')];
    expect(listOrder(nested, null).map((w) => w.id)).toEqual(['q', 'c', 'i']);
  });

  it('reads needs-you, then project by project with its folded stages last, then parked, when grouped', () => {
    expect(listOrder(list, labelOf).map((w) => w.id)).toEqual(['a1', 'b2', 'b1', 'a2', 'p']);
  });
});

describe('homeSections', () => {
  const stages = [
    { name: 'In review', kind: 'waiting' as const },
    { name: 'Done', kind: 'done' as const },
  ];
  const staged = (name: string, kind: 'waiting' | 'done') => ({ stage: { name, kind, since: 1 }, stages });

  it('returns needs-you as one cross-project list and splits each project', () => {
    const list = [
      ws('a1', 'needs-feedback', 'a'),
      ws('b1', 'needs-hands', 'b'),
      ws('a2', 'working', 'a'),
      ws('a3', 'idle', 'a', staged('Done', 'done')),
      ws('b2', 'working', 'b', staged('In review', 'waiting')),
    ];
    const { needsYou, sections } = homeSections(list, labelOf);
    expect(needsYou.map((g) => g.workspace.id)).toEqual(['a1', 'b1']);
    expect(
      sections.map((s) => [s.label, s.active.map((g) => g.workspace.id), s.folded.map((b) => [b.name, b.groups.length])]),
    ).toEqual([
      ['a', ['a2'], [['Done', 1]]],
      ['b', [], [['In review', 1]]],
    ]);
  });

  const activeShape = (list: Workspace[]) =>
    homeSections(list, labelOf).sections.map((s) => [s.label, s.active.map((g) => [g.workspace.id, g.children.map((c) => c.id)])]);

  it('merges the same label on two machines into one section', () => {
    const list = [ws('a', 'idle', 'p', { machineId: 'm1' }), ws('b', 'idle', 'p', { machineId: 'm2' })];
    expect(activeShape(list)).toEqual([['p', [['a', []], ['b', []]]]]);
  });

  it('keeps a child with its orchestrator even when it works in another folder', () => {
    const list = [ws('c', 'working', 'other', { parentId: 'p' }), ws('p', 'idle', 'main')];
    expect(activeShape(list)).toEqual([['main', [['p', ['c']]]]]);
  });

  it('leaves parked workspaces out', () => {
    expect(activeShape([ws('z', 'parked', 'p'), ws('y', 'idle', 'q')])).toEqual([['q', [['y', []]]]]);
  });

  it('places a section where its first group sits, even when it only has folded groups', () => {
    const list = [
      ws('f1', 'idle', 'folded-only', staged('Done', 'done')),
      ws('x1', 'working', 'active'),
      ws('f2', 'idle', 'folded-only', staged('Done', 'done')),
    ];
    expect(homeSections(list, labelOf).sections.map((s) => s.label)).toEqual(['folded-only', 'active']);
  });

  it('orders folded buckets by each project own stage list', () => {
    const order = (names: string[]) => names.map((name) => ({ name, kind: 'waiting' as const }));
    const inP = (id: string, project: string, name: string, names: string[]) =>
      ws(id, 'idle', project, { stage: { name, kind: 'waiting', since: 1 }, stages: order(names) });
    const list = [
      inP('a1', 'a', 'Beta', ['Alpha', 'Beta']),
      inP('a2', 'a', 'Alpha', ['Alpha', 'Beta']),
      inP('b1', 'b', 'Alpha', ['Beta', 'Alpha']),
      inP('b2', 'b', 'Beta', ['Beta', 'Alpha']),
    ];
    const names = homeSections(list, labelOf).sections.map((s) => s.folded.map((b) => b.name));
    expect(names).toEqual([['Alpha', 'Beta'], ['Beta', 'Alpha']]);
  });
});

const shape = (sections: ReturnType<typeof projectSections>) =>
  sections.map((s) => [s.label, s.groups.map((g) => [g.workspace.id, g.children.map((c) => c.id)])]);

describe('projectSections (stages off)', () => {
  it('places each project where its most urgent workspace sits, members in list order', () => {
    const list = [ws('a1', 'needs-feedback', 'a'), ws('b1', 'review', 'b'), ws('a2', 'working', 'a')];
    expect(shape(projectSections(list, labelOf))).toEqual([
      ['a', [['a1', []], ['a2', []]]],
      ['b', [['b1', []]]],
    ]);
  });

  it('gives a project of one workspace its own section', () => {
    expect(shape(projectSections([ws('x', 'idle', 'solo')], labelOf))).toEqual([['solo', [['x', []]]]]);
  });

  it('merges the same label on two machines into one section', () => {
    const list = [ws('a', 'idle', 'p', { machineId: 'm1' }), ws('b', 'idle', 'p', { machineId: 'm2' })];
    expect(shape(projectSections(list, labelOf))).toEqual([['p', [['a', []], ['b', []]]]]);
  });

  it('keeps a child with its orchestrator even when it works in another folder', () => {
    const list = [ws('c', 'needs-feedback', 'other', { parentId: 'p' }), ws('p', 'working', 'main')];
    expect(shape(projectSections(list, labelOf))).toEqual([['main', [['p', ['c']]]]]);
  });

  it('leaves parked workspaces out', () => {
    expect(shape(projectSections([ws('z', 'parked', 'p'), ws('y', 'idle', 'q')], labelOf))).toEqual([
      ['q', [['y', []]]],
    ]);
  });
});

describe('listOrder (stages off)', () => {
  const list = [ws('a1', 'needs-feedback', 'a'), ws('b1', 'review', 'b'), ws('a2', 'working', 'a')];

  it('is the nested order when not grouped', () => {
    expect(listOrder(list, null, false).map((w) => w.id)).toEqual(['a1', 'b1', 'a2']);
  });

  it('walks project by project when grouped', () => {
    expect(listOrder(list, labelOf, false).map((w) => w.id)).toEqual(['a1', 'a2', 'b1']);
  });

  it('ignores stages: nothing is lifted or moved below', () => {
    const done = { stage: { name: 'Done', kind: 'done' as const, since: 1 } };
    const staged = [ws('d', 'idle', 'a', done), ws('n', 'needs-feedback', 'b'), ws('w', 'working', 'a')];
    expect(listOrder(staged, null, false).map((w) => w.id)).toEqual(['d', 'n', 'w']);
  });
});
