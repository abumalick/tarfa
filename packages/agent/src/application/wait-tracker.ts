import type { Workspace } from '@tarfa/contracts';
import { workspaceState } from './format-workspace-table';

export const WAIT_POLL_MS = 2000;
// A stop seen after working must last this long: a queued message's prompt lands about 0.1 s after
// the Stop of the turn it waited behind (measured), and that child has not stopped.
export const WAIT_HOLD_MS = WAIT_POLL_MS;
// A stop already there when the wait began must last this long: right after a `tarfa send` the old
// state lingers until the recipient's turn starts (measured: at most 6.7 s for a recipient that
// could take it). It is still reported after that, or a child that stopped before the wait began,
// on a permission prompt say, would never wake anyone. The cost is one needless wake at worst.
// `needs-orchestrator` always takes this long: the mark stands from the send until the next tool
// starts, while the model may be thinking on, and that child's message woke the orchestrator anyway.
export const WAIT_SETTLE_MS = 10_000;
// No status entry reads as `idle`, which is what a child looks like until its first hook.
export const WAIT_STARTING_MS = 60_000;

export interface WaitReport {
  id: string;
  state: string;
}

// Decides, poll by poll, which of the named workspaces have stopped working. Pure: the caller
// supplies each listing and the time.
export class WaitTracker {
  private readonly seenWorking = new Set<string>();
  private readonly stoppedSince = new Map<string, number>();

  constructor(
    private readonly ids: readonly string[],
    private readonly startedAt: number,
  ) {}

  observe(workspaces: readonly Workspace[], now: number): WaitReport[] {
    const reports: WaitReport[] = [];
    for (const id of this.ids) {
      const workspace = workspaces.find((w) => w.id === id);
      if (!workspace) {
        reports.push({ id, state: 'gone' });
        continue;
      }
      const state = workspaceState(workspace);
      if (state === 'parked') {
        reports.push({ id, state });
      } else if (state === 'working') {
        this.seenWorking.add(id);
        this.stoppedSince.delete(id);
      } else if (state === 'idle' && !this.seenWorking.has(id) && now - workspace.createdAt < WAIT_STARTING_MS) {
        this.stoppedSince.delete(id);
      } else {
        const since = this.stoppedSince.get(id) ?? (this.seenWorking.has(id) ? now : this.startedAt);
        this.stoppedSince.set(id, since);
        const hold = this.seenWorking.has(id) && state !== 'needs-orchestrator' ? WAIT_HOLD_MS : WAIT_SETTLE_MS;
        if (now - since >= hold) reports.push({ id, state });
      }
    }
    return reports;
  }
}
