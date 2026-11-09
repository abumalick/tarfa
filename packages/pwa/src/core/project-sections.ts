import type { Workspace } from '@tarfa/contracts';
import { nestWorkspaces, nestedOrder, type WorkspaceGroup } from './nest-workspaces';

export type ProjectSection = { label: string; groups: WorkspaceGroup[] };

// Buckets the active (unparked) groups by project. `sorted` is already in urgency order, so a
// section takes the place of its first group, and a group is filed under its orchestrator's
// project: a child working in another folder stays beside the parent it reports to.
export function projectSections(
  sorted: readonly Workspace[],
  labelOf: (ws: Workspace) => string,
): ProjectSection[] {
  const sections = new Map<string, ProjectSection>();
  for (const group of nestWorkspaces(sorted)) {
    if (group.workspace.status === 'parked') continue;
    const label = labelOf(group.workspace);
    let section = sections.get(label);
    if (!section) sections.set(label, (section = { label, groups: [] }));
    section.groups.push(group);
  }
  return [...sections.values()];
}

// The order the home list reads in: grouped by project when `labelOf` is given, parked last.
export function listOrder(
  sorted: readonly Workspace[],
  labelOf: ((ws: Workspace) => string) | null,
): Workspace[] {
  if (!labelOf) return nestedOrder(sorted);
  return [
    ...projectSections(sorted, labelOf).flatMap((s) => s.groups.flatMap((g) => [g.workspace, ...g.children])),
    ...sorted.filter((ws) => ws.status === 'parked'),
  ];
}
