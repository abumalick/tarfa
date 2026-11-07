import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installKind, isEntrypoint, packageRoot, packageVersion } from './package-root';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '.tmp');
let dir: string;

beforeAll(async () => {
  await mkdir(ROOT, { recursive: true });
  dir = realpathSync(await mkdtemp(join(ROOT, 'package-root-')));
  await mkdir(join(dir, 'installed', 'dist'), { recursive: true });
  await writeFile(join(dir, 'installed', 'package.json'), '{"name":"x","version":"1.2.3"}');
  await writeFile(join(dir, 'installed', 'dist', 'cli.js'), '');
  await mkdir(join(dir, 'clone', 'src', 'infrastructure'), { recursive: true });
  await writeFile(join(dir, 'clone', 'package.json'), '{"name":"x"}');
  await writeFile(join(dir, 'clone', 'src', 'cli.ts'), '');
  await writeFile(join(dir, 'clone', 'src', 'infrastructure', 'a.ts'), '');
  await mkdir(join(dir, 'bin'), { recursive: true });
  await symlink(join(dir, 'installed', 'dist', 'cli.js'), join(dir, 'bin', 'tarfa'));
});

afterAll(() => rm(dir, { recursive: true, force: true }));

describe('packageRoot', () => {
  it('is the directory holding package.json, from dist/ and from a nested src/ file', () => {
    expect(packageRoot(join(dir, 'installed', 'dist', 'cli.js'))).toBe(join(dir, 'installed'));
    expect(packageRoot(join(dir, 'clone', 'src', 'infrastructure', 'a.ts'))).toBe(join(dir, 'clone'));
  });

  it('follows a symlink to the real file', () => {
    expect(packageRoot(join(dir, 'bin', 'tarfa'))).toBe(join(dir, 'installed'));
  });

  it('finds the real agent package when run from the source tree', () => {
    expect(packageRoot()).toBe(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  });

});

describe('packageVersion', () => {
  it('reads the version from the package.json found by packageRoot', () => {
    expect(packageVersion(join(dir, 'installed', 'dist', 'cli.js'))).toBe('1.2.3');
    expect(() => packageVersion(join(dir, 'clone', 'src', 'cli.ts'))).toThrow(/no version/);
  });
});

describe('installKind', () => {
  it('is a clone when the package has its sources, a package otherwise', () => {
    expect(installKind(join(dir, 'clone', 'src', 'infrastructure', 'a.ts'))).toBe('clone');
    expect(installKind(join(dir, 'installed', 'dist', 'cli.js'))).toBe('package');
  });
});

describe('isEntrypoint', () => {
  it('matches the module file when argv[1] is the file itself', () => {
    const file = join(dir, 'installed', 'dist', 'cli.js');
    expect(isEntrypoint(`file://${file}`, file)).toBe(true);
  });

  it('matches when argv[1] is a symlink to the module file', () => {
    const file = join(dir, 'installed', 'dist', 'cli.js');
    expect(isEntrypoint(`file://${file}`, join(dir, 'bin', 'tarfa'))).toBe(true);
  });

  it('does not match another file, a missing argv[1] or an unresolvable one', () => {
    const file = join(dir, 'installed', 'dist', 'cli.js');
    expect(isEntrypoint(`file://${file}`, join(dir, 'clone', 'src', 'cli.ts'))).toBe(false);
    expect(isEntrypoint(`file://${file}`, undefined)).toBe(false);
    expect(isEntrypoint(`file://${file}`, join(dir, 'missing'))).toBe(false);
  });
});
