export const LONG_PRESS_MS = 500;
export const LONG_PRESS_SLOP_PX = 10;

// A long press on an element that also has an ordinary tap action (a list row). Holding past
// LONG_PRESS_MS marks the element `data-held`; `onHold` runs on the release, never from the
// timer: WebKit grants clipboard writes and the like only inside an input event, and a
// pointerup is one while a timeout is not. The click that follows a hold is swallowed (on the
// element itself, before Svelte's delegated handler at the root sees it). Travel past the slop
// or a `pointercancel` (what WebKit sends once a scroller claims the gesture) cancels it.
export function longPress(node: HTMLElement, onHold: () => void) {
  let handler = onHold;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let origin: { x: number; y: number } | null = null;
  let held = false;
  let swallowClick = false;

  const hold = () => {
    timer = undefined;
    held = true;
    node.setAttribute('data-held', '');
    navigator.vibrate?.(10);
  };
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    origin = null;
    held = false;
    node.removeAttribute('data-held');
  };
  const down = (e: PointerEvent) => {
    swallowClick = false;
    if (e.button > 0) return;
    cancel();
    origin = { x: e.clientX, y: e.clientY };
    timer = setTimeout(hold, LONG_PRESS_MS);
  };
  const move = (e: PointerEvent) => {
    if (origin && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > LONG_PRESS_SLOP_PX) cancel();
  };
  const up = () => {
    if (!held) return cancel();
    cancel();
    swallowClick = true;
    handler();
  };
  const click = (e: MouseEvent) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  };
  // Android opens a context menu (or starts a text selection) on a long press; a menu
  // arriving while armed counts as the hold, so the press still copies on release.
  const contextMenu = (e: Event) => {
    if (!origin) return;
    e.preventDefault();
    if (!held) {
      clearTimeout(timer);
      hold();
    }
  };

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('click', click);
  node.addEventListener('contextmenu', contextMenu);
  return {
    update(next: () => void) {
      handler = next;
    },
    destroy() {
      cancel();
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', cancel);
      node.removeEventListener('click', click);
      node.removeEventListener('contextmenu', contextMenu);
    },
  };
}
