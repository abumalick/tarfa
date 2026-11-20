import type { Workspace } from '@tarfa/contracts';
import { nestWorkspaces, type WorkspaceGroup } from './nest-workspaces';
import { homeGroups, splitGroups, type FoldedBucket } from './stage-groups';

export type StageSection = { label: string; active: WorkspaceGroup[]; folded: FoldedBucket[] };

// The home list: everything needing you in one cross-project list, then per project its active
// groups and its folded stage buckets. A section takes the place of its first group.
export function homeSections(
  sorted: readonly Workspace[],
  labelOf: (ws: Workspace) => string,
): { needsYou: WorkspaceGroup[]; sections: StageSection[] } {
  const groups = nestWorkspaces(sorted);
  const { needsYou } = splitGroups(groups);
  const lifted = new Set(needsYou);
  const byLabel = new Map<string, WorkspaceGroup[]>();
  for (const group of groups) {
    if (lifted.has(group) || group.workspace.status === 'parked') continue;
    const label = labelOf(group.workspace);
    byLabel.set(label, [...(byLabel.get(label) ?? []), group]);
  }
  const sections = [...byLabel].map(([label, members]) => {
    const { active, folded } = splitGroups(members);
    return { label, active, folded };
  });
  return { needsYou, sections };
}

// The order the home list reads in, folded stages included: needs-you, then the active rows
// and the folded stages (project by project when `labelOf` is given), then parked.
export function listOrder(
  sorted: readonly Workspace[],
  labelOf: ((ws: Workspace) => string) | null,
): Workspace[] {
  const rows = (groups: readonly WorkspaceGroup[]) => groups.flatMap((g) => [g.workspace, ...g.children]);
  const rest = (s: { active: WorkspaceGroup[]; folded: FoldedBucket[] }) => [
    ...rows(s.active),
    ...s.folded.flatMap((b) => rows(b.groups)),
  ];
  const parked = sorted.filter((ws) => ws.status === 'parked');
  if (!labelOf) {
    const home = homeGroups(sorted);
    return [...rows(home.needsYou), ...rest(home), ...parked];
  }
  const home = homeSections(sorted, labelOf);
  return [...rows(home.needsYou), ...home.sections.flatMap(rest), ...parked];
}
