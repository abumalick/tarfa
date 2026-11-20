import { describe, expect, it } from 'vitest';
import { DEFAULT_STAGES, findStage, parseStages } from './stage';

describe('parseStages', () => {
  it('defaults the kind to active', () => {
    expect(parseStages({ stages: [{ name: 'In review', kind: 'waiting' }, { name: 'Doing' }] })).toEqual([
      { name: 'In review', kind: 'waiting' },
      { name: 'Doing', kind: 'active' },
    ]);
  });

  it('trims names', () => {
    expect(parseStages({ stages: [{ name: ' Doing ' }] })).toEqual([{ name: 'Doing', kind: 'active' }]);
  });

  it.each([
    ['no stages', {}],
    ['not an object', 'x'],
    ['empty list', { stages: [] }],
    ['duplicate names, case-insensitively', { stages: [{ name: 'a' }, { name: 'A' }] }],
    ['an unknown kind', { stages: [{ name: 'a', kind: 'nope' }] }],
    ['an empty name', { stages: [{ name: '  ' }] }],
    ['a name over 40 characters', { stages: [{ name: 'x'.repeat(41) }] }],
  ])('returns null for %s', (_label, raw) => {
    expect(parseStages(raw)).toBeNull();
  });
});

describe('findStage', () => {
  it('matches case-insensitively and trimmed, returning the list spelling', () => {
    expect(findStage(DEFAULT_STAGES, ' waiting ')?.name).toBe('Waiting');
    expect(findStage(DEFAULT_STAGES, 'nope')).toBeUndefined();
  });
});

describe('DEFAULT_STAGES', () => {
  it('is the four stages', () => {
    expect(DEFAULT_STAGES).toEqual([
      { name: 'In progress', kind: 'active' },
      { name: 'Waiting', kind: 'waiting' },
      { name: 'Blocked', kind: 'waiting' },
      { name: 'Done', kind: 'done' },
    ]);
  });
});
