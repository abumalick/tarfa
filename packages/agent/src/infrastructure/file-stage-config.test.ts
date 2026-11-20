import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_STAGES } from '@tarfa/contracts';
import { FileStageConfig, gitCommonDir, type FileStageConfigDeps } from './file-stage-config';
import { childEnv } from './child-env';

const own = [{ name: 'Review', kind: 'waiting' as const }, { name: 'Shipped', kind: 'done' as const }];
const main = [{ name: 'Triage', kind: 'active' as const }];
const config = (stages: unknown) => JSON.stringify({ stages });

describe('FileStageConfig', () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'stage-config-')));
    mkdirSync(join(root, 'main'));
    mkdirSync(join(root, 'wt'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const make = (over: Partial<FileStageConfigDeps> = {}) => {
    const deps: FileStageConfigDeps = {
      gitCommonDir: async () => join(root, 'main', '.git'),
      readFile: vi.fn(async (p: string) => readFileSync(p, 'utf8')),
      stat: async (p: string) => statSync(p),
      ...over,
    };
    return { deps, sut: new FileStageConfig(deps) };
  };

  it('prefers the file at the project path', async () => {
    writeFileSync(join(root, 'wt', '.tarfa.json'), config(own));
    writeFileSync(join(root, 'main', '.tarfa.json'), config(main));
    expect(await make().sut.stagesFor(join(root, 'wt'))).toEqual(own);
  });

  it('falls back to the main checkout, whose file a worktree may git-ignore away', async () => {
    writeFileSync(join(root, 'main', '.tarfa.json'), config(main));
    expect(await make().sut.stagesFor(join(root, 'wt'))).toEqual(main);
  });

  it('returns the defaults when no file exists', async () => {
    expect(await make().sut.stagesFor(join(root, 'wt'))).toEqual(DEFAULT_STAGES);
  });

  it('returns the defaults for malformed JSON or an invalid list, without throwing', async () => {
    writeFileSync(join(root, 'wt', '.tarfa.json'), '{ nope');
    expect(await make().sut.stagesFor(join(root, 'wt'))).toEqual(DEFAULT_STAGES);
    writeFileSync(join(root, 'wt', '.tarfa.json'), config([{ name: 'A' }, { name: 'a' }]));
    expect(await make().sut.stagesFor(join(root, 'wt'))).toEqual(DEFAULT_STAGES);
  });

  it('names the invalid file it fell back from, and nothing for a valid or missing one', async () => {
    const { sut } = make();
    expect(await sut.invalidConfig(join(root, 'wt'))).toBeNull();
    writeFileSync(join(root, 'main', '.tarfa.json'), '{ nope');
    expect(await sut.invalidConfig(join(root, 'wt'))).toBe(join(root, 'main', '.tarfa.json'));
    writeFileSync(join(root, 'wt', '.tarfa.json'), config(own));
    expect(await sut.invalidConfig(join(root, 'wt'))).toBeNull();
  });

  it('works outside a git repository', async () => {
    writeFileSync(join(root, 'wt', '.tarfa.json'), config(own));
    expect(await make({ gitCommonDir: async () => null }).sut.stagesFor(join(root, 'wt'))).toEqual(own);
  });

  it('re-reads a file only when its mtime changes', async () => {
    const file = join(root, 'wt', '.tarfa.json');
    writeFileSync(file, config(own));
    utimesSync(file, 1000, 1000);
    const { deps, sut } = make();
    await sut.stagesFor(join(root, 'wt'));
    await sut.stagesFor(join(root, 'wt'));
    expect(deps.readFile).toHaveBeenCalledTimes(1);
    writeFileSync(file, config(main));
    utimesSync(file, 2000, 2000);
    expect(await sut.stagesFor(join(root, 'wt'))).toEqual(main);
    expect(deps.readFile).toHaveBeenCalledTimes(2);
  });

  it('resolves the git common dir once per project path', async () => {
    const gitCommonDirSpy = vi.fn(async () => join(root, 'main', '.git'));
    const { sut } = make({ gitCommonDir: gitCommonDirSpy });
    await sut.stagesFor(join(root, 'wt'));
    await sut.stagesFor(join(root, 'wt'));
    expect(gitCommonDirSpy).toHaveBeenCalledTimes(1);
  });

  it('picks up a file created after the first call', async () => {
    const { sut } = make();
    expect(await sut.stagesFor(join(root, 'wt'))).toEqual(DEFAULT_STAGES);
    writeFileSync(join(root, 'main', '.tarfa.json'), config(main));
    expect(await sut.stagesFor(join(root, 'wt'))).toEqual(main);
  });
});

describe('gitCommonDir (real git)', () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'stage-git-')));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, env: Object.fromEntries(Object.entries(childEnv()).filter(([k]) => !k.startsWith('GIT_'))), stdio: 'pipe' });

  it('finds the main checkout from a linked worktree, and a stage file there', async () => {
    const repo = join(root, 'repo');
    mkdirSync(repo);
    git(repo, 'init', '-q');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
    const wt = join(root, 'wt');
    git(repo, 'worktree', 'add', '-q', wt, '-b', 'feature');
    writeFileSync(join(repo, '.tarfa.json'), config(main));

    expect(await gitCommonDir(wt)).toBe(join(repo, '.git'));
    expect(await gitCommonDir(repo)).toBe(join(repo, '.git'));
    expect(await new FileStageConfig().stagesFor(wt)).toEqual(main);
  });

  it('returns null outside a repository', async () => {
    expect(await gitCommonDir(root)).toBeNull();
  });
});
