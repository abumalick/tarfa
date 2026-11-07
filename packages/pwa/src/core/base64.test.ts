import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from './base64';

const btoaOf = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));

describe('bytesToBase64', () => {
  it('matches btoa for every length remainder, padding included', () => {
    const bytes = Uint8Array.from({ length: 7 }, (_, i) => 250 - i * 37);
    for (let length = 0; length <= bytes.length; length += 1) {
      const slice = bytes.subarray(0, length);
      expect(bytesToBase64(slice)).toBe(btoaOf(slice));
    }
  });

  it('encodes every byte value', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(bytesToBase64(bytes)).toBe(btoaOf(bytes));
  });

  it('beats building a binary string for btoa by a wide margin', () => {
    const bytes = new Uint8Array(4 * 1024 * 1024).map((_, i) => (i * 31) & 255);
    let start = performance.now();
    const encoded = bytesToBase64(bytes);
    const fast = performance.now() - start;
    start = performance.now();
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    const expected = btoa(binary);
    const slow = performance.now() - start;
    expect(encoded).toBe(expected);
    expect(fast * 5).toBeLessThan(slow);
  });
});
