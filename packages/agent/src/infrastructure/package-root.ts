import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type InstallKind = 'package' | 'clone';

// The directory holding the running file's package.json, found from the file's real path so a bin
// symlink or a version-manager shim still lands in the package. The same from src/** and dist/.
export function packageRoot(file: string = fileURLToPath(import.meta.url)): string {
  let dir = dirname(realpathSync(file));
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no package.json above ${file}`);
    dir = parent;
  }
  return dir;
}

export function packageVersion(file?: string): string {
  const { version } = JSON.parse(readFileSync(join(packageRoot(file), 'package.json'), 'utf8')) as { version?: string };
  if (!version) throw new Error('package.json has no version');
  return version;
}

// A clone runs the sources through tsx; the published package carries only dist/.
export function installKind(file?: string): InstallKind {
  return existsSync(join(packageRoot(file), 'src', 'cli.ts')) ? 'clone' : 'package';
}

// Whether this module was started as the program: both sides by real path, since a bin symlink
// or a shim makes argv[1] differ from the module's own path.
export function isEntrypoint(moduleUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argv1);
  } catch {
    return false;
  }
}
