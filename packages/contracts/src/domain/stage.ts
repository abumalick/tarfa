import { z } from 'zod';

export const STAGE_KINDS = ['active', 'waiting', 'done'] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export interface ProjectStage {
  name: string;
  kind: StageKind;
}

export interface WorkspaceStage {
  name: string;
  kind: StageKind;
  since: number;
}

export const DEFAULT_STAGES: readonly ProjectStage[] = [
  { name: 'In progress', kind: 'active' },
  { name: 'Waiting', kind: 'waiting' },
  { name: 'Blocked', kind: 'waiting' },
  { name: 'Done', kind: 'done' },
];

export const stageKindSchema = z.enum(STAGE_KINDS);

export const tarfaConfigSchema = z.object({
  stages: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(40),
        kind: stageKindSchema.default('active'),
      }),
    )
    .optional(),
});

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// null: absent, invalid, empty or with duplicate names — the caller then uses DEFAULT_STAGES.
export function parseStages(raw: unknown): ProjectStage[] | null {
  const parsed = tarfaConfigSchema.safeParse(raw);
  const stages = parsed.success ? parsed.data.stages : undefined;
  if (!stages || stages.length === 0) return null;
  const names = new Set(stages.map((s) => s.name.toLowerCase()));
  return names.size === stages.length ? stages : null;
}

export function findStage(stages: readonly ProjectStage[], name: string): ProjectStage | undefined {
  return stages.find((s) => sameName(s.name, name));
}
