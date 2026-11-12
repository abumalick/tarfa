import { describe, it, expect, vi, afterEach } from 'vitest';
import { sortable } from './sortable';

// jsdom has no layout: each row is given a 50px box stacked from y=0.
function list(count: number) {
  const ul = document.createElement('ul');
  for (let i = 0; i < count; i++) {
    const li = document.createElement('li');
    li.setAttribute('data-sort-row', '');
    li.getBoundingClientRect = () => ({ top: i * 50, height: 50 }) as DOMRect;
    const handle = document.createElement('button');
    handle.setAttribute('data-sort-handle', '');
    li.append(handle);
    ul.append(li);
  }
  const extra = document.createElement('li');
  extra.textContent = 'Add';
  ul.append(extra);
  document.body.append(ul);
  const onMove = vi.fn();
  const action = sortable(ul, { onMove });
  destroy = action.destroy;
  const handles = [...ul.querySelectorAll<HTMLElement>('[data-sort-handle]')];
  return { ul, onMove, action, handles };
}

function pointer(target: EventTarget, type: string, clientY: number) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientY }) as unknown as PointerEvent;
  Object.defineProperty(e, 'pointerId', { value: 1 });
  target.dispatchEvent(e);
}

let destroy: (() => void) | null = null;
afterEach(() => {
  destroy?.();
  document.body.innerHTML = '';
});

describe('sortable', () => {
  it('moves the dragged row to where it is dropped, once', () => {
    const { onMove, handles } = list(3);
    pointer(handles[0]!, 'pointerdown', 10);
    pointer(handles[0]!, 'pointermove', 40);
    pointer(handles[0]!, 'pointermove', 90);
    expect(onMove).not.toHaveBeenCalled();
    pointer(handles[0]!, 'pointerup', 90);
    expect(onMove).toHaveBeenCalledOnce();
    expect(onMove).toHaveBeenCalledWith(0, 2);
  });

  it('slides the rows it passes while dragging, and clears them on drop', () => {
    const { ul, handles } = list(3);
    const rows = [...ul.querySelectorAll<HTMLElement>('[data-sort-row]')];
    pointer(handles[2]!, 'pointerdown', 120);
    pointer(handles[2]!, 'pointermove', 90);
    expect(rows[2]!.style.transform).toBe('translateY(-30px)');
    expect(rows[1]!.style.transform).toBe('translateY(50px)');
    expect(rows[0]!.style.transform).toBe('');
    pointer(handles[2]!, 'pointerup', 90);
    expect(rows.map((r) => r.style.transform)).toEqual(['', '', '']);
  });

  it('does nothing when dropped where it started', () => {
    const { onMove, handles } = list(3);
    pointer(handles[1]!, 'pointerdown', 70);
    pointer(handles[1]!, 'pointermove', 80);
    pointer(handles[1]!, 'pointerup', 80);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('does nothing when the browser cancels the drag', () => {
    const { onMove, handles } = list(3);
    pointer(handles[0]!, 'pointerdown', 10);
    pointer(handles[0]!, 'pointermove', 90);
    pointer(handles[0]!, 'pointercancel', 90);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('cancels when the dragged row leaves the page, and can drag again', () => {
    const { onMove, handles } = list(3);
    pointer(handles[0]!, 'pointerdown', 10);
    pointer(handles[0]!, 'pointermove', 90);
    handles[0]!.closest('li')!.remove();
    pointer(document, 'lostpointercapture', 90);
    pointer(document.body, 'pointerup', 90);
    expect(onMove).not.toHaveBeenCalled();
    pointer(handles[1]!, 'pointerdown', 70);
    pointer(handles[1]!, 'pointermove', 130);
    pointer(handles[1]!, 'pointerup', 130);
    expect(onMove).toHaveBeenCalledWith(0, 1);
  });

  // A list re-rendered under the finger (an entry added in another window) would make the
  // indexes name other rows.
  it('drops nothing when the list changed during the drag', () => {
    const { ul, onMove, handles } = list(3);
    pointer(handles[0]!, 'pointerdown', 10);
    pointer(handles[0]!, 'pointermove', 90);
    ul.querySelector('[data-sort-row]:nth-child(2)')!.remove();
    pointer(handles[0]!, 'pointerup', 90);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('ignores a press outside a handle', () => {
    const { ul, onMove } = list(2);
    const row = ul.querySelector('[data-sort-row]')!;
    pointer(row, 'pointerdown', 10);
    pointer(row, 'pointermove', 90);
    pointer(row, 'pointerup', 90);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('moves a row by one with the arrow keys, never past either end', () => {
    const { onMove, handles } = list(3);
    const key = (target: Element, k: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    key(handles[0]!, 'ArrowDown');
    expect(onMove).toHaveBeenLastCalledWith(0, 1);
    key(handles[2]!, 'ArrowUp');
    expect(onMove).toHaveBeenLastCalledWith(2, 1);
    onMove.mockClear();
    key(handles[0]!, 'ArrowUp');
    key(handles[2]!, 'ArrowDown');
    expect(onMove).not.toHaveBeenCalled();
  });
});
