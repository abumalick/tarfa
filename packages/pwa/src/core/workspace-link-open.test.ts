import { describe, expect, it } from 'vitest';
import { generateAgentKeys } from '@tarfa/secure-channel';
import { resolveLinkOpen, takeWorkspaceLinkFragment } from './workspace-link-open';

const key = generateAgentKeys().x25519.publicKey;
const other = generateAgentKeys().x25519.publicKey;
const mac = { id: 'mac', name: 'Mac', addresses: ['wss://mac'], agentKey: ` ${key}\n` };
const mini = { id: 'mini', name: 'Mini', addresses: ['wss://mini'], agentKey: other };
const link = { agentKey: key, workspaceId: 'app-3' };
const ws = (machineId: string, id: string) => ({ machineId, id });

describe('resolveLinkOpen', () => {
  it('opens the workspace on the machine whose key the link names', () => {
    const workspaces = [ws('mini', 'app-3'), ws('mac', 'app-3')];
    expect(resolveLinkOpen(link, { machines: [mini, mac], workspaces, freshList: false })).toEqual({ kind: 'open', workspace: ws('mac', 'app-3') });
  });

  it('refuses a key no entry holds, and a switched-off entry at once', () => {
    expect(resolveLinkOpen(link, { machines: [mini], workspaces: [], freshList: true })).toEqual({ kind: 'fail', reason: 'notPaired' });
    const off = { ...mac, enabled: false };
    expect(resolveLinkOpen(link, { machines: [off], workspaces: [ws('mac', 'app-3')], freshList: true })).toEqual({ kind: 'fail', reason: 'switchedOff', machine: off });
  });

  it('waits on a list from before the link, and calls the workspace gone only on a fresh one', () => {
    const workspaces = [ws('mini', 'app-3'), ws('mac', 'app-1')];
    expect(resolveLinkOpen(link, { machines: [mac, mini], workspaces, freshList: false })).toEqual({ kind: 'wait', machine: mac });
    expect(resolveLinkOpen(link, { machines: [mac, mini], workspaces, freshList: true })).toEqual({ kind: 'fail', reason: 'gone', machine: mac });
  });
});

describe('takeWorkspaceLinkFragment', () => {
  it('reads the link off the location before clearing it, and leaves any other location alone', () => {
    const location = { hash: `#open?k=${key}&w=app-3`, pathname: '/', search: '' };
    const replaced: string[] = [];
    const taken = takeWorkspaceLinkFragment(location, (url) => {
      replaced.push(url);
      location.hash = '';
    });
    expect(taken).toEqual(link);
    expect(replaced).toEqual(['/']);
    expect(takeWorkspaceLinkFragment({ hash: `#pair?k=${key}`, pathname: '/', search: '' }, (url) => replaced.push(url))).toBeNull();
    expect(replaced).toEqual(['/']);
  });
});
