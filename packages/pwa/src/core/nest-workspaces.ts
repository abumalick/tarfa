import type { Workspace } from '@tarfa/contracts';

export type WorkspaceGroup = { workspace: Workspace; children: Workspace[] };

const key = (machineId: string, id: string) => `${machineId}:${id}`;

// The orchestrator each workspace nests under, if any. A child nests only under a listed,
// unparked parent on the same connection that is not itself a child (one level), so a parked
// or missing parent, or a cycle, leaves it top-level rather than hidden.
export function nestingParents(workspaces: readonly Workspace[]): (ws: Workspace) => Workspace | undefined {
  const byKey = new Map(workspaces.map((ws) => [key(ws.machineId, ws.id), ws]));
  const parentOf = (ws: Workspace): Workspace | undefined => {
    if (!ws.parentId || ws.parentId === ws.id || ws.status === 'parked') return undefined;
    const parent = byKey.get(key(ws.machineId, ws.parentId));
    return parent && parent.status !== 'parked' ? parent : undefined;
  };
  return (ws) => {
    const parent = parentOf(ws);
    return parent && !parentOf(parent) ? parent : undefined;
  };
}

// Lifts each child under its orchestrator. `sorted` is already in list order, so a group
// takes the place of its first member: a working parent with a child that needs you sorts
// with that child.
export function nestWorkspaces(sorted: readonly Workspace[]): WorkspaceGroup[] {
  const nestingParent = nestingParents(sorted);
  const groups = new Map<Workspace, { lead: number; group: WorkspaceGroup }>();
  const groupFor = (ws: Workspace, index: number) => {
    let entry = groups.get(ws);
    if (!entry) groups.set(ws, (entry = { lead: index, group: { workspace: ws, children: [] } }));
    entry.lead = Math.min(entry.lead, index);
    return entry.group;
  };
  sorted.forEach((ws, index) => {
    const parent = nestingParent(ws);
    if (parent) groupFor(parent, index).children.push(ws);
    else groupFor(ws, index);
  });
  return [...groups.values()].sort((a, b) => a.lead - b.lead).map((e) => e.group);
}

// The order the list reads in once nested: each parent, then its children.
export function nestedOrder(sorted: readonly Workspace[]): Workspace[] {
  return nestWorkspaces(sorted).flatMap((g) => [g.workspace, ...g.children]);
}
