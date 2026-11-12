// Geometry of a drag-to-reorder list: the dragged row follows the pointer, the rows it passes
// slide out of its way, and the list is reordered once, on drop.

export interface RowBox {
  top: number;
  height: number;
}

const middle = (row: RowBox) => row.top + row.height / 2;

// Where the dragged row lands: it takes a neighbour's place once its leading edge passes that
// neighbour's middle.
export function dropIndex(rows: RowBox[], from: number, offset: number): number {
  const top = rows[from]!.top + offset;
  const bottom = top + rows[from]!.height;
  const passedBelow = rows.filter((row, i) => i > from && middle(row) < bottom).length;
  const passedAbove = rows.filter((row, i) => i < from && middle(row) > top).length;
  return from + passedBelow - passedAbove;
}

export function rowShift(index: number, from: number, to: number, height: number): number {
  if (from < to && index > from && index <= to) return -height;
  if (to < from && index >= to && index < from) return height;
  return 0;
}

export function clampOffset(rows: RowBox[], from: number, offset: number): number {
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const row = rows[from]!;
  const min = first.top - row.top;
  const max = last.top + last.height - (row.top + row.height);
  return Math.min(max, Math.max(min, offset));
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
