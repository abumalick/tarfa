export const POPOVER_MARGIN = 4;

// A popover is anchored by its right edge to the key that opened it, so near the left of the
// screen it would grow off it; this shifts it right just enough to stay inside the viewport.
export function clampRight(anchorRight: number, width: number, viewportWidth: number): number {
  return Math.max(POPOVER_MARGIN, Math.min(anchorRight, viewportWidth - width - POPOVER_MARGIN));
}
