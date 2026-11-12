import { describe, it, expect } from 'vitest';
import { clampOffset, dropIndex, moveItem, rowShift, type RowBox } from './drag-reorder';

// Three 50px rows stacked from y=100.
const rows: RowBox[] = [
  { top: 100, height: 50 },
  { top: 150, height: 50 },
  { top: 200, height: 50 },
];

describe('dropIndex', () => {
  it('stays put until the dragged row passes a neighbour’s middle', () => {
    expect(dropIndex(rows, 0, 0)).toBe(0);
    expect(dropIndex(rows, 0, 24)).toBe(0);
    expect(dropIndex(rows, 0, 26)).toBe(1);
    expect(dropIndex(rows, 0, 76)).toBe(2);
  });

  it('moves up past rows above', () => {
    expect(dropIndex(rows, 2, -26)).toBe(1);
    expect(dropIndex(rows, 2, -76)).toBe(0);
  });
});

describe('rowShift', () => {
  it('slides the rows the dragged one passes, by its height, and leaves the rest', () => {
    expect([0, 1, 2].map((i) => rowShift(i, 0, 2, 50))).toEqual([0, -50, -50]);
    expect([0, 1, 2].map((i) => rowShift(i, 2, 1, 50))).toEqual([0, 50, 0]);
    expect([0, 1, 2].map((i) => rowShift(i, 1, 1, 50))).toEqual([0, 0, 0]);
  });
});

describe('clampOffset', () => {
  it('keeps the dragged row inside the list', () => {
    expect(clampOffset(rows, 1, -500)).toBe(-50);
    expect(clampOffset(rows, 1, 500)).toBe(50);
    expect(clampOffset(rows, 1, 10)).toBe(10);
  });
});

describe('moveItem', () => {
  it('moves one item to an index, keeping the others in order', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });
});
