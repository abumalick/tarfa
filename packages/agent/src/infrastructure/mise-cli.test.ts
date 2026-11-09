import { describe, expect, it } from 'vitest';
import { findInstalledCli, findMise } from './mise-cli';

describe('findMise', () => {
  it('prefers the usual places, then PATH, else null', () => {
    const has = (...paths: string[]) => (p: string) => paths.includes(p);
    expect(findMise('/h', '/usr/bin', has('/h/.local/bin/mise', '/usr/bin/mise'))).toBe('/h/.local/bin/mise');
    expect(findMise('/h', '/x:/usr/bin', has('/usr/bin/mise'))).toBe('/usr/bin/mise');
    expect(findMise('/h', undefined, has())).toBeNull();
  });
});

describe('findInstalledCli', () => {
  const has = (...paths: string[]) => (p: string) => paths.includes(p);

  it('takes bin/tarfa, where npm lays the package out', () => {
    expect(findInstalledCli('/i', has('/i/bin/tarfa', '/i/node_modules/@tarfa/cli/dist/cli.js'))).toBe('/i/bin/tarfa');
  });

  it('takes the package entry under node_modules, where aube lays it out (its .bin/tarfa is a shell script)', () => {
    expect(findInstalledCli('/i', has('/i/node_modules/.bin/tarfa', '/i/node_modules/@tarfa/cli/dist/cli.js'))).toBe('/i/node_modules/@tarfa/cli/dist/cli.js');
  });

  it('is null for an install holding neither', () => {
    expect(findInstalledCli('/i', has('/i/node_modules/.bin/tarfa'))).toBeNull();
    expect(findInstalledCli('', has('/bin/tarfa'))).toBeNull();
  });
});
