import { describe, expect, it } from 'vitest';
import { clampRight } from './popover-position';

describe('clampRight', () => {
  it('keeps the anchor when the popover fits', () => {
    expect(clampRight(40, 200, 390)).toBe(40);
  });
  it('shifts a popover that would leave the left edge back inside it', () => {
    expect(clampRight(350, 200, 390)).toBe(186);
  });
  it('never goes past the right margin', () => {
    expect(clampRight(0, 200, 390)).toBe(4);
    expect(clampRight(100, 400, 390)).toBe(4);
  });
});
