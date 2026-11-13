import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { longPress, LONG_PRESS_MS, LONG_PRESS_SLOP_PX } from './long-press';

function pointer(node: Element, type: string, x = 100, y = 100) {
  node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
}

describe('longPress', () => {
  let node: HTMLButtonElement;
  let onHold: ReturnType<typeof vi.fn>;
  let onClick: ReturnType<typeof vi.fn>;
  let action: { destroy: () => void };

  beforeEach(() => {
    vi.useFakeTimers();
    node = document.createElement('button');
    document.body.append(node);
    onHold = vi.fn();
    onClick = vi.fn();
    // Stands in for Svelte's delegated handler, which listens above the row.
    document.body.addEventListener('click', onClick);
    action = longPress(node, onHold);
  });
  afterEach(() => {
    action.destroy();
    document.body.removeEventListener('click', onClick);
    node.remove();
    vi.useRealTimers();
  });

  it('calls onHold on the release after a hold, and swallows the click', () => {
    pointer(node, 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(node.hasAttribute('data-held')).toBe(true);
    expect(onHold).not.toHaveBeenCalled();
    pointer(node, 'pointerup');
    expect(onHold).toHaveBeenCalledOnce();
    expect(node.hasAttribute('data-held')).toBe(false);
    pointer(node, 'click');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('leaves a short tap alone', () => {
    pointer(node, 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    pointer(node, 'pointerup');
    pointer(node, 'click');
    expect(onHold).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is cancelled by a drag past the slop', () => {
    pointer(node, 'pointerdown');
    pointer(node, 'pointermove', 100, 100 + LONG_PRESS_SLOP_PX + 1);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    pointer(node, 'pointerup');
    expect(onHold).not.toHaveBeenCalled();
  });

  it('is cancelled by pointercancel, which is what a scroll sends', () => {
    pointer(node, 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS);
    pointer(node, 'pointercancel');
    pointer(node, 'pointerup');
    expect(onHold).not.toHaveBeenCalled();
    expect(node.hasAttribute('data-held')).toBe(false);
  });

  it('takes a context menu during the press as the hold and blocks the menu', () => {
    pointer(node, 'pointerdown');
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    node.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    pointer(node, 'pointerup');
    expect(onHold).toHaveBeenCalledOnce();
  });

  it('leaves a context menu outside a press alone (a desktop right-click)', () => {
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    node.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(false);
  });

  it('lets the next tap through when a hold sent no click', () => {
    pointer(node, 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS);
    pointer(node, 'pointerup');
    pointer(node, 'pointerdown');
    pointer(node, 'pointerup');
    pointer(node, 'click');
    expect(onClick).toHaveBeenCalledOnce();
  });
});
