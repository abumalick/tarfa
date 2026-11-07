import { describe, expect, it } from 'vitest';
import { findMise } from './mise-cli';

describe('findMise', () => {
  it('prefers the usual places, then PATH, else null', () => {
    const has = (...paths: string[]) => (p: string) => paths.includes(p);
    expect(findMise('/h', '/usr/bin', has('/h/.local/bin/mise', '/usr/bin/mise'))).toBe('/h/.local/bin/mise');
    expect(findMise('/h', '/x:/usr/bin', has('/usr/bin/mise'))).toBe('/usr/bin/mise');
    expect(findMise('/h', undefined, has())).toBeNull();
  });
});
