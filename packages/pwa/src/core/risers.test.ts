import { describe, it, expect } from 'vitest';
import type { Workspace } from '@tarfa/contracts';
import { risers, urgency, type Ranked } from './risers';

// Each item is `key` or `key:score`; a lower score is more urgent, and an item without one scores 5.
const items = (spec: string): Ranked[] =>
  spec
    .split(' ')
    .filter(Boolean)
    .map((s) => {
      const [key, score] = s.split(':');
      return { key: key!, score: score === undefined ? 5 : Number(score) };
    });
const seq = (entries: Record<string, string>) =>
  new Map(Object.entries(entries).map(([id, spec]) => [id, items(spec)]));

describe('risers', () => {
  it('names the item that grew more urgent and overtook another', () => {
    expect(risers(seq({ l: 'a b c' }), seq({ l: 'c:1 a b' }))).toEqual(new Set(['c']));
  });

  it('names nothing when an item sinks past the others', () => {
    expect(risers(seq({ l: 'a:1 b c' }), seq({ l: 'b c a:5' }))).toEqual(new Set());
  });

  it('tells which of two swapped items moved', () => {
    expect(risers(seq({ l: 'a:1 b:2' }), seq({ l: 'b:0 a:1' }))).toEqual(new Set(['b']));
    expect(risers(seq({ l: 'a:1 b:2' }), seq({ l: 'b:2 a:3' }))).toEqual(new Set());
  });

  it('names nothing when an item grows more urgent without passing anyone', () => {
    expect(risers(seq({ l: 'a:3 b' }), seq({ l: 'a:1 b' }))).toEqual(new Set());
  });

  it('names nothing when items only close up behind one that left', () => {
    expect(risers(seq({ l: 'a b c' }), seq({ l: 'b c' }))).toEqual(new Set());
  });

  it('names nothing when a new item arrives on top', () => {
    expect(risers(seq({ l: 'a b' }), seq({ l: 'n:0 a b' }))).toEqual(new Set());
  });

  it('names nothing on the first list', () => {
    expect(risers(new Map(), seq({ l: 'a b' }))).toEqual(new Set());
  });

  it('compares each sequence on its own', () => {
    const before = seq({ sections: 'p:2 q:3', p: 'p1:2 p2:4', q: 'q1:3' });
    const after = seq({ sections: 'q:1 p:2', p: 'p1:2 p2:4', q: 'q1:1' });
    expect(risers(before, after)).toEqual(new Set(['q']));
  });

  it('ignores an item that moved into another sequence', () => {
    expect(risers(seq({ p: 'a:1', q: 'b' }), seq({ p: '', q: 'a:0 b' }))).toEqual(new Set());
  });
});

describe('urgency', () => {
  const w = (status: Workspace['status'], urgent = false) =>
    ({ id: 'x', name: 'x', machineId: 'm', projectPath: '/p', command: 'bash', createdAt: 0, lastActivityAt: 0, status, urgent }) as Workspace;

  it('follows the list order: status first, then urgent', () => {
    expect(urgency([w('needs-feedback')])).toBeLessThan(urgency([w('needs-hands', true)]));
    expect(urgency([w('working', true)])).toBeLessThan(urgency([w('working')]));
  });

  it('takes the most urgent of several', () => {
    expect(urgency([w('working'), w('needs-feedback')])).toBe(urgency([w('needs-feedback')]));
  });
});
