import type { Workspace } from '@tarfa/contracts';
import type { BrowserCommandPort } from '../ports/browser-command-port';
import type { BrowserDiscoveryPort } from '../ports/browser-discovery-port';
import type { Clock } from '../ports/clock';
import type { ParkedStorePort } from '../ports/parked-store-port';
import type { ProcessScopePort } from '../ports/process-scope-port';
import type { StatusStorePort } from '../ports/status-store-port';
import type { TmuxPort } from '../ports/tmux-port';
import type { WorkspaceLogPort } from '../ports/workspace-log-port';
import { closeWorkspace } from './close-workspace';
import { closeWorkspaceBrowserSessions } from './close-workspace-browsers';
import { reapWorkspaceScope } from './reap-workspace-scope';
import { recordWorkspaceClosed } from './record-workspace-closed';

export interface RetireWorkspaceDeps {
  tmux: TmuxPort;
  scopes?: ProcessScopePort;
  parked: ParkedStorePort;
  status: Pick<StatusStorePort, 'get' | 'getClaudeSessionId'>;
  workspaceLog: WorkspaceLogPort;
  clock: Clock;
  // See WsServer.forgetWorkspace.
  forgetWorkspace: (id: string, closing?: boolean) => Workspace | undefined;
  // See WsServer.dropWorkspaceState.
  dropWorkspaceState?: (id: string) => void;
  // The live workspace with this id, for one no poll has observed yet (created and closed within
  // the same tick).
  snapshot: (id: string) => Promise<Workspace | undefined>;
}

// An explicit close, from the phone or `tarfa close`: the workspace stops existing and is logged
// `closed-by-user`. Returns the scope its pane lived in, for finishClose once the caller has
// acknowledged the close.
export async function retireWorkspace(deps: RetireWorkspaceDeps, id: string): Promise<string | null> {
  const parkedRecord = await deps.parked.get(id);
  const workspace =
    deps.forgetWorkspace(id, true) ??
    (parkedRecord
      ? {
          machineId: parkedRecord.machineId,
          id: parkedRecord.id,
          name: parkedRecord.name,
          projectPath: parkedRecord.projectPath,
          command: parkedRecord.command,
          createdAt: parkedRecord.createdAt,
          lastActivityAt: parkedRecord.parkedAt,
          status: 'parked' as const,
        }
      : await deps.snapshot(id));
  // Read first: once neither tmux nor parked.json holds the id, the poll may drop its
  // status entry (WsServer.dropGoneWorkspaces) before the log entry below is written.
  const lastStatus = deps.status.get(id);
  const claudeSessionId = parkedRecord ? parkedRecord.claudeSessionId : deps.status.getClaudeSessionId(id);
  if (parkedRecord) {
    await deps.parked.remove(id);
  }
  const scope = await closeWorkspace({ tmux: deps.tmux, scopes: deps.scopes }, id);
  if (workspace) {
    await recordWorkspaceClosed(
      {
        workspaceLog: deps.workspaceLog,
        status: { get: () => lastStatus, getClaudeSessionId: () => claudeSessionId },
        clock: deps.clock,
      },
      workspace,
      'closed-by-user',
    );
  }
  deps.dropWorkspaceState?.(id);
  return scope;
}

// The slow tail of a close, run detached once the client has been acknowledged. Both steps
// swallow their own failures; the outer catch only guards against an unhandled rejection
// taking the agent down for work nobody is waiting on.
export async function finishClose(
  deps: { scopes?: ProcessScopePort; browserDiscovery: BrowserDiscoveryPort; browserCommands: BrowserCommandPort },
  id: string,
  scope: string | null,
): Promise<void> {
  try {
    await reapWorkspaceScope({ scopes: deps.scopes }, scope);
    await closeWorkspaceBrowserSessions({ discovery: deps.browserDiscovery, commands: deps.browserCommands }, id);
  } catch {
    // best-effort
  }
}
