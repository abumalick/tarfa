import { describe, expect, it } from 'vitest';
import { generateAgentKeys } from '@tarfa/secure-channel';
import type { PairingStorePort } from '../ports/pairing-store-port';
import { mintPairing, pairingName, type PairingDeps } from './pairing-link';
import { PAIRING_TTL_MS, type Pairing } from './pairing';

const NOW = new Date('2026-09-26T12:00:00.000Z');
const keys = generateAgentKeys();
const ADDRESS = 'wss://dev.example.ts.net:10000/abu';

function setup(options: { defaultPath?: string } = {}) {
  let pairingList: Pairing[] = [];
  const pairings: PairingStorePort = {
    read: async () => pairingList,
    update: async (change) => (pairingList = change(pairingList)),
  };
  let n = 0;
  const deps: PairingDeps = {
    keys,
    machineId: 'dev',
    pairings,
    newSecret: () => String(++n).padStart(43, 'x'),
    now: () => NOW,
    ...(options.defaultPath !== undefined ? { defaultPath: options.defaultPath } : {}),
  };
  return { deps, pairings: () => pairingList };
}

describe('mintPairing', () => {
  it('stores a one-time secret for the default lifetime and hands it to the phone with the agent key', async () => {
    const s = setup();
    const pairing = await mintPairing(s.deps, { phoneUrls: [ADDRESS] });
    const [stored] = s.pairings();
    expect(Date.parse(stored!.expiresAt) - NOW.getTime()).toBe(PAIRING_TTL_MS);
    expect(pairing).toEqual({ urls: [ADDRESS], agentKey: keys.x25519.publicKey, secret: stored!.secret, name: 'dev' });
  });

  it('carries every phone address, in order, as given', async () => {
    const phoneUrls = [ADDRESS, 'wss://dev.example.ts.net:8443/abu'];
    expect((await mintPairing(setup().deps, { phoneUrls })).urls).toEqual(phoneUrls);
  });

  // A path the phone would drop is refused before a secret is minted, rather than silently ignored.
  it('carries the default path when the machine has one, and refuses one the phone would drop', async () => {
    const mint = (defaultPath?: string) => mintPairing(setup({ defaultPath }).deps, { phoneUrls: [ADDRESS] });
    expect((await mint('/home/u/workspace')).defaultPath).toBe('/home/u/workspace');
    expect((await mint()).defaultPath).toBeUndefined();
    const s = setup({ defaultPath: 'workspace' });
    await expect(mintPairing(s.deps, { phoneUrls: [ADDRESS] })).rejects.toThrow(/TARFA_DEFAULT_PATH.*absolute/);
    expect(s.pairings()).toEqual([]);
  });
});

describe('pairingName', () => {
  it('is the configured machine id', () => {
    expect(pairingName('studio', 'box.example.net')).toBe('studio');
  });

  it('is the host name, without its domain, when the machine id is a generic placeholder', () => {
    expect(pairingName('local', 'box.example.net')).toBe('box');
    expect(pairingName('localhost', 'box')).toBe('box');
    expect(pairingName('', 'box')).toBe('box');
  });
});
