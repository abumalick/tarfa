import { execFile } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_STAGES, parseStages, type ProjectStage } from '@tarfa/contracts';
import type { StageConfigPort } from '../ports/stage-config-port';
import { childEnv } from './child-env';

const exec = promisify(execFile);

export const STAGE_CONFIG_FILE = '.tarfa.json';

// A git hook exports GIT_DIR and friends, which would make `-C` name some other repository.
function withoutGitVars(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('GIT_')));
}

export async function gitCommonDir(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await exec('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      env: withoutGitVars(childEnv()),
    });
    return (await realpath(stdout.trim())) || null;
  } catch {
    return null;
  }
}

export interface FileStageConfigDeps {
  gitCommonDir: (cwd: string) => Promise<string | null>;
  readFile: (path: string) => Promise<string>;
  stat: (path: string) => Promise<{ mtimeMs: number }>;
}

const realDeps: FileStageConfigDeps = {
  gitCommonDir,
  readFile: (path) => readFile(path, 'utf8'),
  stat,
};

export class FileStageConfig implements StageConfigPort {
  // A project's candidate files are resolved once, so git never runs on each poll.
  private readonly candidates = new Map<string, Promise<string[]>>();
  private readonly parsed = new Map<string, { mtimeMs: number; stages: ProjectStage[] | null }>();

  constructor(private readonly deps: FileStageConfigDeps = realDeps) {}

  async stagesFor(projectPath: string): Promise<ProjectStage[]> {
    return (await this.resolve(projectPath)).stages;
  }

  async invalidConfig(projectPath: string): Promise<string | null> {
    return (await this.resolve(projectPath)).invalid ?? null;
  }

  private async resolve(projectPath: string): Promise<{ stages: ProjectStage[]; invalid?: string }> {
    for (const file of await this.candidatesFor(projectPath)) {
      const entry = await this.load(file);
      if (entry === null) return { stages: [...DEFAULT_STAGES], invalid: file };
      if (entry !== undefined) return { stages: entry };
    }
    return { stages: [...DEFAULT_STAGES] };
  }

  private candidatesFor(projectPath: string): Promise<string[]> {
    let found = this.candidates.get(projectPath);
    if (!found) {
      found = this.resolveCandidates(projectPath);
      this.candidates.set(projectPath, found);
    }
    return found;
  }

  private async resolveCandidates(projectPath: string): Promise<string[]> {
    const own = join(projectPath, STAGE_CONFIG_FILE);
    const common = await this.deps.gitCommonDir(projectPath).catch(() => null);
    if (!common) return [own];
    const main = join(dirname(common), STAGE_CONFIG_FILE);
    return main === own ? [own] : [own, main];
  }

  // undefined: no such file. null: the file exists but holds no valid stage list.
  private async load(file: string): Promise<ProjectStage[] | null | undefined> {
    let mtimeMs: number;
    try {
      mtimeMs = (await this.deps.stat(file)).mtimeMs;
    } catch {
      this.parsed.delete(file);
      return undefined;
    }
    const cached = this.parsed.get(file);
    if (cached && cached.mtimeMs === mtimeMs) return cached.stages;
    let stages: ProjectStage[] | null = null;
    try {
      stages = parseStages(JSON.parse(await this.deps.readFile(file)));
    } catch {
      stages = null;
    }
    this.parsed.set(file, { mtimeMs, stages });
    return stages;
  }
}
