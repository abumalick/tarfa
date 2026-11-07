// `tarfa update`: install a release with mise, then run that release's own `tarfa apply`. The
// running version never changes the service itself, so a failed install leaves the machine as it was.
import { compareSemver, isSemver } from './semver';

export interface UpdateEffects {
  installKind(): 'package' | 'clone';
  currentVersion(): string;
  // The mise executable, or null.
  findMise(): string | null;
  // The registry's newest version; throws with the reason when it cannot say.
  latest(): Promise<string>;
  // `mise use -g npm:@tarfa/cli@<version>`.
  install(mise: string, version: string): Promise<void>;
  // Where that version and its node live, resolved from $HOME so no folder's mise config interferes.
  locate(mise: string, version: string): Promise<{ node: string; cli: string }>;
  // Runs `<node> <cli> apply` with the caller's stdio; returns its exit code.
  apply(node: string, cli: string): Promise<number>;
  log(line: string): void;
}

export async function runUpdate(effects: UpdateEffects, options: { version?: string; force: boolean }): Promise<{ exitCode: number; message: string }> {
  const fail = (message: string, exitCode = 1) => ({ exitCode, message });
  if (effects.installKind() === 'clone') return fail('this is a source install; git pull', 2);
  if (options.version !== undefined && !isSemver(options.version)) return fail(`--version must be a release number like 1.2.3 (got ${options.version})`, 2);
  const mise = effects.findMise();
  if (mise === null) return fail('tarfa update needs mise, which installed this package: install mise, or reinstall with `mise use -g npm:@tarfa/cli`');

  const current = effects.currentVersion();
  let target = options.version;
  if (target === undefined) {
    try {
      target = await effects.latest();
    } catch (err) {
      return fail(`could not read the newest version from the npm registry (${err instanceof Error ? err.message : String(err)}): nothing changed`);
    }
    if (!isSemver(target)) return fail(`the npm registry named "${target}" as the newest version, which is not a release number: nothing changed`);
  }

  const order = compareSemver(target, current);
  if (order === 0 && !options.force) return { exitCode: 0, message: `already on ${current}; nothing to do (--force installs and applies it again)` };
  if (order < 0 && options.version === undefined && !options.force) return { exitCode: 0, message: `${current} is newer than the registry's latest ${target}; nothing to do` };
  effects.log(order < 0 ? `installing ${target}, older than ${current} (a rollback)` : `installing ${target} (running ${current})`);

  try {
    await effects.install(mise, target);
  } catch (err) {
    return fail(`failed: install ${target}: ${err instanceof Error ? err.message : String(err)}\n${current} stays installed and the service is untouched`);
  }
  let located: { node: string; cli: string };
  try {
    located = await effects.locate(mise, target);
  } catch (err) {
    return fail(`installed ${target}, but could not find it to apply it: ${err instanceof Error ? err.message : String(err)}\nrun \`tarfa apply\` once that works`);
  }
  effects.log(`applying ${target}`);
  const code = await effects.apply(located.node, located.cli);
  if (code !== 0) return fail(`tarfa apply of ${target} exited ${code}; read its lines above (rerun \`tarfa apply\` after fixing, or \`tarfa update --version ${current}\` to go back)`, code);
  return { exitCode: 0, message: `updated ${current} to ${target}` };
}
