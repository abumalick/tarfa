import { describe, it, expect } from 'vitest';
import { appIdentity, parseAppFlavor } from './app-flavor';

describe('app-flavor', () => {
  it('is production when nothing names a flavor', () => {
    expect(parseAppFlavor(undefined)).toBe('production');
    expect(parseAppFlavor('')).toBe('production');
  });

  it('reads dev', () => {
    expect(parseAppFlavor('dev')).toBe('dev');
    expect(parseAppFlavor('production')).toBe('production');
  });

  it('fails the build on an unknown flavor rather than shipping the wrong identity', () => {
    expect(() => parseAppFlavor('staging')).toThrow(/TARFA_APP_FLAVOR/);
  });

  it('keeps the production identity as it was', () => {
    const id = appIdentity('production');
    expect(id.name).toBe('Tarfa');
    expect(id.shortName).toBe('Tarfa');
    expect(id.appleTouchIcon).toBe('/apple-touch-icon.png');
    expect(id.icons.map((i) => i.src)).toEqual([
      'icon-192.png',
      'icon-512.png',
      'icon-192-maskable.png',
      'icon-512-maskable.png',
    ]);
  });

  it('gives dev its own name and every icon its -dev twin', () => {
    const prod = appIdentity('production');
    const dev = appIdentity('dev');
    expect(dev.name).toBe('Tarfa Dev');
    expect(dev.shortName).toBe('Tarfa Dev');
    expect(dev.appleTouchIcon).toBe('/apple-touch-icon-dev.png');
    expect(dev.flavor).toBe('dev');
    expect(prod.flavor).toBe('production');
    expect(dev.icons).toEqual(prod.icons.map((i) => ({ ...i, src: i.src.replace('.png', '-dev.png') })));
  });
});
