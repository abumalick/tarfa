import { MAX_ADDRESSES } from '@tarfa/secure-channel';
import { normalizeAddress } from './machine-addresses';
import { isConnectable, type MachineConfig } from './settings-store';

// How long a candidate the phone could not reach waits before a session or a foreground dials it
// again: a phone that rarely runs Tailscale would otherwise hold a dead socket on every one.
export const FAILED_RETRY_MS = 5 * 60_000;

// What started a round: a new session (the agent just named its addresses), the app coming to
// the foreground, or the browser regaining the network.
export type SyncTrigger = 'session' | 'visible' | 'network';

// The addresses an agent names, as an entry would hold them.
export function listedAddresses(raw: string[] | undefined): string[] {
  const listed: string[] = [];
  for (const address of (raw ?? []).flatMap((a) => normalizeAddress(a) ?? [])) {
    if (!listed.includes(address)) listed.push(address);
  }
  return listed.slice(0, MAX_ADDRESSES);
}

function held(machine: MachineConfig): string[] {
  return machine.addresses.map((a) => normalizeAddress(a) ?? a);
}

// The listed addresses the entry does not hold yet, less any another key's entry holds: taking
// one would point it at this key, as a pairing link naming it would (`pairedMachine`).
export function addressCandidates(entry: MachineConfig, listed: string[], machines: MachineConfig[]): string[] {
  const own = held(entry);
  const taken = machines.filter((m) => m.agentKey?.trim() !== entry.agentKey.trim()).flatMap(held);
  return listed.filter((a) => !own.includes(a) && !taken.includes(a));
}

// The entry's addresses once the agent's list is taken into account: what the agent lists comes
// first, in its order (held or proven only), then the held addresses it no longer lists. Those are
// never dropped on the agent's word, only tried last; one leaves the tail only when a proven
// address needs its slot.
export function syncedAddresses(heldAddresses: string[], listed: string[], proven: string[]): string[] {
  const first = listed.filter((a) => heldAddresses.includes(a) || proven.includes(a));
  const rest = heldAddresses.filter((a) => !listed.includes(a));
  return [...first, ...rest].slice(0, MAX_ADDRESSES);
}

export interface AddressSyncDeps {
  machines: () => MachineConfig[];
  // One attempt through the entry's addresses (ConnectionManager.probe).
  probe: (config: MachineConfig) => Promise<boolean>;
  // Stores the entry, which reconnects it.
  write: (config: MachineConfig) => void;
  now: () => number;
}

// Keeps each entry's addresses on what its agent says, adopting a listed address only once the
// phone has connected through it. Held in memory: the agent names its list at every session.
export class AddressSync {
  private readonly listed = new Map<string, string[]>();
  // When each `<machine> <address>` candidate last failed its probe.
  private readonly failed = new Map<string, number>();
  private readonly running = new Set<string>();

  constructor(private readonly deps: AddressSyncDeps) {}

  announce(machineId: string, addresses: string[] | undefined): void {
    this.listed.set(machineId, listedAddresses(addresses));
  }

  runAll(trigger: SyncTrigger): Promise<void> {
    return Promise.all([...this.listed.keys()].map((id) => this.run(id, trigger))).then(() => undefined);
  }

  // One round: each eligible candidate probed alone, one at a time, then at most one write.
  async run(machineId: string, trigger: SyncTrigger): Promise<void> {
    if (this.running.has(machineId)) return;
    this.running.add(machineId);
    try {
      // Never inside the caller: a session's status handler is still running when it asks.
      await Promise.resolve();
      const listed = this.listed.get(machineId) ?? [];
      const entry = this.deps.machines().find((m) => m.id === machineId);
      if (listed.length === 0 || !entry || entry.pairing || !isConnectable(entry)) return;
      const proven: string[] = [];
      for (const candidate of addressCandidates(entry, listed, this.deps.machines()).filter((a) => this.eligible(machineId, a, trigger))) {
        const key = `${machineId} ${candidate}`;
        if (await this.deps.probe({ ...entry, addresses: [candidate], pairing: undefined })) {
          proven.push(candidate);
          this.failed.delete(key);
        } else {
          this.failed.set(key, this.deps.now());
        }
      }
      const current = this.deps.machines().find((m) => m.id === machineId);
      // Proven for the key the round dialed, so only for an entry still pinned to it.
      if (!current || current.agentKey !== entry.agentKey) return;
      const stillFree = addressCandidates(current, listed, this.deps.machines());
      const heldNow = held(current);
      const next = syncedAddresses(heldNow, listed, proven.filter((a) => stillFree.includes(a)));
      // Compared as normalized: a spelling alone is no reason to reconnect.
      if (next.join('\n') !== heldNow.join('\n')) this.deps.write({ ...current, addresses: next });
    } finally {
      this.running.delete(machineId);
    }
  }

  private eligible(machineId: string, address: string, trigger: SyncTrigger): boolean {
    const failedAt = this.failed.get(`${machineId} ${address}`);
    if (failedAt === undefined || trigger === 'network') return true;
    return this.deps.now() - failedAt >= FAILED_RETRY_MS;
  }
}
