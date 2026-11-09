import { describe, it, expect } from 'vitest';
import type { Workspace, WorkspaceStatus } from '@tarfa/contracts';
import { listOrder, projectSections } from './project-sections';

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
const shape = (sections: ReturnType<typeof projectSections>) =>
  sections.map((s) => [s.label, s.groups.map((g) => [g.workspace.id, g.children.map((c) => c.id)])]);

describe('projectSections', () => {
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

describe('listOrder', () => {
  const list = [ws('a1', 'needs-feedback', 'a'), ws('b1', 'review', 'b'), ws('a2', 'working', 'a')];

  it('is the nested order when not grouped', () => {
    expect(listOrder(list, null).map((w) => w.id)).toEqual(['a1', 'b1', 'a2']);
  });

  it('walks project by project when grouped', () => {
    expect(listOrder(list, labelOf).map((w) => w.id)).toEqual(['a1', 'a2', 'b1']);
  });
});
