import { clampOffset, dropIndex, rowShift, type RowBox } from '../core/drag-reorder';

// Drag-to-reorder for a list: rows carry `data-sort-row`, each with a `data-sort-handle` button.
// Dragging a handle moves its row with the pointer and slides the rows it passes; the list is
// reordered once, on drop, through `onMove`. Nothing in the DOM moves during the drag, so the
// pointer capture holds. The handle's ArrowUp/ArrowDown move its row by one.
export interface SortableOptions {
  onMove: (from: number, to: number) => void;
}

export function sortable(node: HTMLElement, options: SortableOptions) {
  let opts = options;
  let drag: { from: number; startY: number; rows: HTMLElement[]; boxes: RowBox[]; pointerId: number; to: number } | null = null;

  const rowsOf = () => [...node.querySelectorAll<HTMLElement>('[data-sort-row]')];

  function reset(rows: HTMLElement[]) {
    for (const row of rows) {
      row.style.transform = '';
      row.style.transition = '';
      row.style.zIndex = '';
      row.style.position = '';
      row.removeAttribute('data-dragging');
    }
  }

  function onPointerDown(e: PointerEvent) {
    const handle = (e.target as Element).closest('[data-sort-handle]');
    const row = handle?.closest<HTMLElement>('[data-sort-row]');
    if (!handle || !row || drag || e.button > 0) return;
    const rows = rowsOf();
    const from = rows.indexOf(row);
    if (from < 0) return;
    e.preventDefault();
    (handle as HTMLElement).setPointerCapture?.(e.pointerId);
    const boxes = rows.map((r) => {
      const rect = r.getBoundingClientRect();
      return { top: rect.top, height: rect.height };
    });
    drag = { from, startY: e.clientY, rows, boxes, pointerId: e.pointerId, to: from };
    row.setAttribute('data-dragging', '');
    row.style.position = 'relative';
    row.style.zIndex = '1';
    for (const r of rows) if (r !== row) r.style.transition = 'transform 150ms ease';
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const offset = clampOffset(drag.boxes, drag.from, e.clientY - drag.startY);
    drag.to = dropIndex(drag.boxes, drag.from, offset);
    const height = drag.boxes[drag.from]!.height;
    drag.rows.forEach((r, i) => {
      const y = i === drag!.from ? offset : rowShift(i, drag!.from, drag!.to, height);
      r.style.transform = y ? `translateY(${y}px)` : '';
    });
  }

  function finish(e: PointerEvent, commit: boolean) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { from, to, rows } = drag;
    drag = null;
    reset(rows);
    const now = rowsOf();
    const unchanged = now.length === rows.length && now.every((r, i) => r === rows[i]);
    if (commit && unchanged && to !== from) opts.onMove(from, to);
  }

  const onPointerUp = (e: PointerEvent) => finish(e, true);
  const onPointerCancel = (e: PointerEvent) => finish(e, false);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const handle = (e.target as Element).closest<HTMLElement>('[data-sort-handle]');
    const row = handle?.closest<HTMLElement>('[data-sort-row]');
    if (!handle || !row) return;
    const rows = rowsOf();
    const from = rows.indexOf(row);
    const to = from + (e.key === 'ArrowUp' ? -1 : 1);
    if (from < 0 || to < 0 || to >= rows.length) return;
    e.preventDefault();
    opts.onMove(from, to);
    // The keyed list moves this row's node; focus may not survive the move.
    requestAnimationFrame(() => handle.focus());
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  // On the window: a handle removed mid-drag loses its capture (announced at the document), and
  // the up then lands outside the list.
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('lostpointercapture', onPointerCancel);
  node.addEventListener('keydown', onKeyDown);
  return {
    update(next: SortableOptions) {
      opts = next;
    },
    destroy() {
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('lostpointercapture', onPointerCancel);
      node.removeEventListener('keydown', onKeyDown);
    },
  };
}
