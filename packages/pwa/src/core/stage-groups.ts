import type { Workspace, WorkspaceStage } from '@tarfa/contracts';
import { nestWorkspaces, type WorkspaceGroup } from './nest-workspaces';

type LegacyStatus = 'review' | 'blocked' | 'finished';
export type DisplayStage = WorkspaceStage & { legacy?: LegacyStatus };
export type FoldedBucket = { name: string; kind: 'waiting' | 'done'; groups: WorkspaceGroup[] };
export type HomeGroups = { needsYou: WorkspaceGroup[]; active: WorkspaceGroup[]; folded: FoldedBucket[] };

const LEGACY_KIND = { review: 'waiting', blocked: 'waiting', finished: 'done' } as const;

// The stage a row shows: its own, else the one its legacy status stands for.
export function effectiveStage(ws: Workspace): DisplayStage | undefined {
  if (ws.stage) return ws.stage;
  if (ws.status !== 'review' && ws.status !== 'blocked' && ws.status !== 'finished') return undefined;
  return { name: ws.status, kind: LEGACY_KIND[ws.status], since: ws.lastActivityAt, legacy: ws.status };
}

export const needsYou = (ws: Workspace): boolean =>
  !ws.waiting && (ws.status === 'needs-feedback' || ws.status === 'needs-hands');

const stageIndex = (ws: Workspace, name: string): number => {
  const i = ws.stages?.findIndex((s) => s.name === name) ?? -1;
  return i < 0 ? Number.POSITIVE_INFINITY : i;
};

// Splits the nested list. A group needing you anywhere (parent or child) goes to needsYou whole,
// so nothing needing you is ever folded. `sorted` order is kept within every bucket.
export const homeGroups = (sorted: readonly Workspace[]): HomeGroups => splitGroups(nestWorkspaces(sorted));

// Same split over groups already nested; bucket order comes from the stage lists of these groups only.
export function splitGroups(groups: readonly WorkspaceGroup[]): HomeGroups {
  const result: HomeGroups = { needsYou: [], active: [], folded: [] };
  const buckets = new Map<string, FoldedBucket & { index: number; order: number }>();
  for (const group of groups) {
    if (group.workspace.status === 'parked') continue;
    if (needsYou(group.workspace) || group.children.some(needsYou)) {
      result.needsYou.push(group);
      continue;
    }
    const stage = effectiveStage(group.workspace);
    if (!stage || stage.kind === 'active') {
      result.active.push(group);
      continue;
    }
    const key = `${stage.kind}:${stage.name}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        name: stage.name,
        kind: stage.kind,
        groups: [],
        index: stageIndex(group.workspace, stage.name),
        order: buckets.size,
      };
      buckets.set(key, bucket);
    }
    bucket.groups.push(group);
  }
  const kindRank = { waiting: 0, done: 1 };
  result.folded = [...buckets.values()]
    .sort((a, b) => kindRank[a.kind] - kindRank[b.kind] || a.index - b.index || a.order - b.order)
    .map(({ name, kind, groups }) => ({ name, kind, groups }));
  return result;
}
