import { describe, it, expect, vi, afterEach } from 'vitest';
import { motionDuration, prefersReducedMotion, reorderDuration, REORDER_MS, ENTER_LEAVE_MS } from './motion';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduce : false,
    addEventListener() {},
    removeEventListener() {},
  }));
}

describe('prefersReducedMotion', () => {
  it('is true when the user asks to reduce motion', () => {
    stubReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
  });

  it('is false when the user does not', () => {
    stubReducedMotion(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it('falls back to false when matchMedia is unavailable (jsdom)', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('motionDuration', () => {
  it('returns the base duration when motion is allowed', () => {
    stubReducedMotion(false);
    expect(motionDuration(REORDER_MS)).toBe(REORDER_MS);
    expect(motionDuration(ENTER_LEAVE_MS)).toBe(ENTER_LEAVE_MS);
  });

  it('collapses to zero when motion is reduced', () => {
    stubReducedMotion(true);
    expect(motionDuration(REORDER_MS)).toBe(0);
    expect(motionDuration(ENTER_LEAVE_MS)).toBe(0);
  });
});

describe('reorderDuration', () => {
  it('gives a long climb more time than a short one, within bounds', () => {
    stubReducedMotion(false);
    expect(reorderDuration(10)).toBe(REORDER_MS);
    expect(reorderDuration(400)).toBeGreaterThan(reorderDuration(100));
    expect(reorderDuration(10_000)).toBe(600);
  });

  it('collapses to zero when motion is reduced', () => {
    stubReducedMotion(true);
    expect(reorderDuration(400)).toBe(0);
  });
});
