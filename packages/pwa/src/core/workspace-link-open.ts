import { parseWorkspaceLink, WORKSPACE_LINK_PREFIX, type WorkspaceLink } from '@tarfa/contracts';
import { parseAgentKey } from './agent-key';
import type { MachineConfig } from './settings-store';

export type LinkOpenOutcome<W> =
  | { kind: 'wait'; machine: MachineConfig }
  | { kind: 'open'; workspace: W }
  | { kind: 'fail'; reason: 'notPaired' }
  | { kind: 'fail'; reason: 'switchedOff' | 'gone'; machine: MachineConfig };

// The entry a link names, by its agent key's bytes: a key typed into Settings may be spelt with
// whitespace around it.
export function linkedMachine(machines: readonly MachineConfig[], link: WorkspaceLink): MachineConfig | null {
  const want = parseAgentKey(link.agentKey);
  if (!want) return null;
  return machines.find((m) => {
    const key = parseAgentKey(m.agentKey);
    return key !== null && key.length === want.length && key.every((b, i) => b === want[i]);
  }) ?? null;
}

// `freshList`: the machine sent its list after the link was opened. A list from before (an app
// resumed from the background) may predate the workspace, so only a fresh one proves it gone.
export function resolveLinkOpen<W extends { machineId: string; id: string }>(
  link: WorkspaceLink,
  state: { machines: readonly MachineConfig[]; workspaces: readonly W[]; freshList: boolean },
): LinkOpenOutcome<W> {
  const machine = linkedMachine(state.machines, link);
  if (!machine) return { kind: 'fail', reason: 'notPaired' };
  if (machine.enabled === false) return { kind: 'fail', reason: 'switchedOff', machine };
  const workspace = state.workspaces.find((w) => w.machineId === machine.id && w.id === link.workspaceId);
  if (workspace) return { kind: 'open', workspace };
  return state.freshList ? { kind: 'fail', reason: 'gone', machine } : { kind: 'wait', machine };
}

// A workspace link the app was launched or navigated with: taken off the address at once.
export function takeWorkspaceLinkFragment(
  location: { hash: string; pathname: string; search: string },
  replace: (url: string) => void,
): WorkspaceLink | null {
  // Read before replacing: `location` is live, and the replace empties its hash.
  const { hash, pathname, search } = location;
  if (!hash.startsWith(WORKSPACE_LINK_PREFIX)) return null;
  replace(`${pathname}${search}`);
  return parseWorkspaceLink(hash);
}
