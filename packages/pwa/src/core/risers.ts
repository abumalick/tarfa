import { WORKSPACE_STATUSES, type Workspace } from '@tarfa/contracts';

export type Ranked = { key: string; score: number };

// The items that climbed between two orderings of the home list, so the list can point at what
// moved. An item counts when it passed another (its rank among the items present in both went
// down) and its own score grew more urgent (lower): position alone cannot tell "b rose" from
// "a sank", and when one item sinks every item it passes moves up a rank. Each sequence (the
// project order, each project's rows) is compared on its own: an item moving between sequences
// is new where it lands.
export function risers(before: Map<string, Ranked[]>, after: Map<string, Ranked[]>): Set<string> {
  const rose = new Set<string>();
  for (const [id, next] of after) {
    const prev = before.get(id);
    if (!prev) continue;
    const nextKeys = new Set(next.map((i) => i.key));
    const prevCommon = prev.filter((i) => nextKeys.has(i.key));
    const old = new Map(prevCommon.map((i, rank) => [i.key, { rank, score: i.score }]));
    next
      .filter((i) => old.has(i.key))
      .forEach((i, rank) => {
        const was = old.get(i.key)!;
        if (rank < was.rank && i.score < was.score) rose.add(i.key);
      });
  }
  return rose;
}

// How urgent the most urgent of these workspaces is, in the list's own sort order (status, then
// urgent first); lower is more urgent.
export function urgency(workspaces: readonly Workspace[]): number {
  return Math.min(
    ...workspaces.map((ws) => WORKSPACE_STATUSES.indexOf(ws.status) * 2 + (ws.urgent ? 0 : 1)),
  );
}
