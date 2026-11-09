// Animation timings for the workspace list. Centralized so the
// prefers-reduced-motion gate lives in one tested place instead of being
// scattered through the markup. Durations are read at the moment each
// flip/transition starts, so honoring the OS setting needs no subscription.

export const REORDER_MS = 200;
export const ENTER_LEAVE_MS = 180;

export function prefersReducedMotion(): boolean {
  const mm = typeof window !== 'undefined' ? window.matchMedia : undefined;
  return mm ? mm.call(window, '(prefers-reduced-motion: reduce)').matches : false;
}

export function motionDuration(baseMs: number): number {
  return prefersReducedMotion() ? 0 : baseMs;
}

// A reorder slide's length follows how far the row travels, so a workspace climbing the whole
// list moves slowly enough to follow while a swap with its neighbour stays quick.
const MAX_REORDER_MS = 600;
export function reorderDuration(distancePx: number): number {
  return motionDuration(Math.min(MAX_REORDER_MS, Math.max(REORDER_MS, Math.sqrt(distancePx) * 25)));
}
