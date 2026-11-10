import { describe, expect, it } from 'vitest';
import { AddressSync, addressCandidates, listedAddresses, syncedAddresses, FAILED_RETRY_MS } from './address-sync';
import type { MachineConfig } from './settings-store';

const KEY = 'k'.repeat(43);
const A = 'wss://a.example/';
const B = 'wss://b.example/';
const C = 'wss://c.example/';
const D = 'wss://d.example/';
const E = 'wss://e.example/';

function machine(addresses: string[], extra: Partial<MachineConfig> = {}): MachineConfig {
  return { id: 'm1', name: 'box', addresses, agentKey: KEY, ...extra };
}

describe('listedAddresses', () => {
  it('normalizes what the agent names, dropping what no entry could hold', () => {
    expect(listedAddresses(['wss://a.example', 'http://x.example', 'wss://b.example/', 'wss://a.example/'])).toEqual([A, B]);
  });

  it('is empty for an agent that names nothing', () => {
    expect(listedAddresses(undefined)).toEqual([]);
  });

  it('keeps at most as many as an entry holds', () => {
    expect(listedAddresses([A, B, C, D, E])).toEqual([A, B, C, D]);
  });
});

describe('addressCandidates', () => {
  it('is what the agent lists that the entry does not hold', () => {
    expect(addressCandidates(machine([A]), [A, B], [machine([A])])).toEqual([B]);
  });

  it('never offers an address another key holds', () => {
    const other = { id: 'm2', name: 'other', addresses: [B], agentKey: 'o'.repeat(43) };
    expect(addressCandidates(machine([A]), [A, B, C], [machine([A]), other])).toEqual([C]);
  });

  it('compares held addresses normalized', () => {
    expect(addressCandidates(machine(['wss://a.example']), [A], [])).toEqual([]);
  });
});

describe('syncedAddresses', () => {
  it('puts the listed addresses first, in the agent order, then the unlisted held ones', () => {
    expect(syncedAddresses([C, A, B], [B, A], [])).toEqual([B, A, C]);
  });

  it('adds a proven candidate where the agent lists it', () => {
    expect(syncedAddresses([A], [B, A], [B])).toEqual([B, A]);
  });

  it('never adds a listed address that is neither held nor proven', () => {
    expect(syncedAddresses([A], [B, A], [])).toEqual([A]);
  });

  it('never drops a held address the agent no longer lists', () => {
    expect(syncedAddresses([A, B], [A], [])).toEqual([A, B]);
  });

  it('evicts an unlisted held address from the tail only for a proven candidate', () => {
    expect(syncedAddresses([A, B, C, D], [A], [])).toEqual([A, B, C, D]);
    expect(syncedAddresses([A, B, C, D], [E, A], [E])).toEqual([E, A, B, C]);
  });
});

function harness(initial: MachineConfig[], reachable: Set<string>) {
  let machines = initial;
  let now = 0;
  const probes: string[] = [];
  const writes: MachineConfig[] = [];
  const sync = new AddressSync({
    machines: () => machines,
    probe: async (config) => {
      probes.push(...config.addresses);
      expect(config.addresses).toHaveLength(1);
      expect(config.pairing).toBeUndefined();
      return reachable.has(config.addresses[0]!);
    },
    write: (config) => {
      writes.push(config);
      machines = machines.map((m) => (m.id === config.id ? config : m));
    },
    now: () => now,
  });
  return { sync, probes, writes, advance: (ms: number) => (now += ms), replace: (next: MachineConfig[]) => (machines = next) };
}

describe('AddressSync', () => {
  it('adopts a listed address once it connects through it, in one write', async () => {
    const h = harness([machine([A])], new Set([B, C]));
    h.sync.announce('m1', [C, A, B]);
    await h.sync.run('m1', 'session');
    expect(h.probes).toEqual([C, B]);
    expect(h.writes.map((m) => m.addresses)).toEqual([[C, A, B]]);
  });

  it('writes nothing when the entry already matches, so the session its write causes changes nothing', async () => {
    const h = harness([machine([A])], new Set([B]));
    h.sync.announce('m1', [A, B]);
    await h.sync.run('m1', 'session');
    h.sync.announce('m1', [A, B]);
    await h.sync.run('m1', 'session');
    expect(h.writes).toHaveLength(1);
    expect(h.probes).toEqual([B]);
  });

  it('writes a reorder alone, without probing', async () => {
    const h = harness([machine([A, B])], new Set());
    h.sync.announce('m1', [B, A]);
    await h.sync.run('m1', 'session');
    expect(h.probes).toEqual([]);
    expect(h.writes.map((m) => m.addresses)).toEqual([[B, A]]);
  });

  it('does nothing for an agent that lists nothing', async () => {
    const h = harness([machine([A, B])], new Set());
    h.sync.announce('m1', undefined);
    await h.sync.run('m1', 'session');
    expect(h.writes).toEqual([]);
  });

  it('keeps a candidate it cannot reach, without a write, and does not probe it again on the next session', async () => {
    const h = harness([machine([A])], new Set());
    h.sync.announce('m1', [B, A]);
    await h.sync.run('m1', 'session');
    expect(h.writes.map((m) => m.addresses)).toEqual([]);
    await h.sync.run('m1', 'session');
    expect(h.probes).toEqual([B]);
  });

  it('demotes rather than waits: the listed held address still moves first while a candidate is unreachable', async () => {
    const h = harness([machine([C, A])], new Set());
    h.sync.announce('m1', [B, A]);
    await h.sync.run('m1', 'session');
    expect(h.writes.map((m) => m.addresses)).toEqual([[A, C]]);
  });

  it('probes a failed candidate again on a foreground only after a gap, and on a network change at once', async () => {
    const reachable = new Set<string>();
    const h = harness([machine([A])], reachable);
    h.sync.announce('m1', [A, B]);
    await h.sync.run('m1', 'session');
    h.advance(FAILED_RETRY_MS - 1);
    await h.sync.runAll('visible');
    expect(h.probes).toEqual([B]);
    await h.sync.runAll('network');
    expect(h.probes).toEqual([B, B]);
    h.advance(FAILED_RETRY_MS);
    reachable.add(B);
    await h.sync.runAll('visible');
    expect(h.probes).toEqual([B, B, B]);
    expect(h.writes.map((m) => m.addresses)).toEqual([[A, B]]);
  });

  it('is single-flight: a trigger during a round is skipped', async () => {
    let release: (ok: boolean) => void = () => undefined;
    const probes: string[] = [];
    const sync = new AddressSync({
      machines: () => [machine([A])],
      probe: (config) => {
        probes.push(config.addresses[0]!);
        return new Promise((resolve) => (release = resolve));
      },
      write: () => undefined,
      now: () => 0,
    });
    sync.announce('m1', [A, B]);
    const first = sync.run('m1', 'session');
    await Promise.resolve();
    await Promise.resolve();
    await sync.run('m1', 'network');
    release(false);
    await first;
    expect(probes).toEqual([B]);
  });

  it('leaves an entry still holding its pairing code alone', async () => {
    const h = harness([machine([A], { pairing: 'code' })], new Set([B]));
    h.sync.announce('m1', [A, B]);
    await h.sync.run('m1', 'session');
    expect(h.probes).toEqual([]);
  });

  it('applies the round to the entry as it is once the probes are done', async () => {
    const h = harness([machine([A])], new Set([B]));
    h.sync.announce('m1', [A, B]);
    const round = h.sync.run('m1', 'session');
    h.replace([{ ...machine([A, C]), name: 'renamed' }]);
    await round;
    expect(h.writes.at(-1)).toMatchObject({ name: 'renamed', addresses: [A, B, C] });
  });

  it('never starts inside the caller: the round begins on a later tick', () => {
    const h = harness([machine([A, B])], new Set());
    h.sync.announce('m1', [B, A]);
    void h.sync.run('m1', 'session');
    expect(h.writes).toEqual([]);
  });
});
