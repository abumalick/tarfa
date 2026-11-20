import type { Workspace } from '@tarfa/contracts';
import { nestWorkspaces, nestedOrder, type WorkspaceGroup } from './nest-workspaces';
import { homeGroups, type FoldedBucket } from './stage-groups';

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

export type StageSection = { label: string; active: WorkspaceGroup[]; folded: FoldedBucket[] };

// The home list: everything needing you in one cross-project list, then per project its active
// groups and its folded stage buckets. A section takes the place of its first group.
export function homeSections(
  sorted: readonly Workspace[],
  labelOf: (ws: Workspace) => string,
): { needsYou: WorkspaceGroup[]; sections: StageSection[] } {
  const { needsYou, active, folded } = homeGroups(sorted);
  const lead = new Map<WorkspaceGroup, number>();
  nestWorkspaces(sorted).forEach((g, i) => lead.set(g, i));
  const sections = new Map<string, StageSection & { lead: number }>();
  const sectionFor = (group: WorkspaceGroup) => {
    const label = labelOf(group.workspace);
    let section = sections.get(label);
    if (!section) sections.set(label, (section = { label, active: [], folded: [], lead: Infinity }));
    section.lead = Math.min(section.lead, lead.get(group) ?? Infinity);
    return section;
  };
  for (const group of active) sectionFor(group).active.push(group);
  for (const bucket of folded) {
    for (const group of bucket.groups) {
      const section = sectionFor(group);
      let into = section.folded.find((b) => b.name === bucket.name && b.kind === bucket.kind);
      if (!into) section.folded.push((into = { name: bucket.name, kind: bucket.kind, groups: [] }));
      into.groups.push(group);
    }
  }
  return {
    needsYou,
    sections: [...sections.values()].sort((a, b) => a.lead - b.lead).map(({ lead: _lead, ...s }) => s),
  };
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
