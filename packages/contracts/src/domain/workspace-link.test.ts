import { describe, expect, it } from 'vitest';
import { parseWorkspaceLink, workspaceLink } from './workspace-link';

const key = 'A'.repeat(42) + 'Q';
const link = { agentKey: key, workspaceId: 'perch-3' };

describe('workspace links', () => {
  it('builds the link on the PWA origin', () => {
    expect(workspaceLink('https://tarfa.app/x', link)).toBe(`https://tarfa.app/#open?k=${key}&w=perch-3`);
  });

  it('reads back what it builds, as a URL or a bare fragment, whitespace around', () => {
    expect(parseWorkspaceLink(workspaceLink('https://tarfa.app', link))).toEqual(link);
    expect(parseWorkspaceLink(`#open?k=${key}&w=perch-3`)).toEqual(link);
    expect(parseWorkspaceLink(`  https://tarfa.app/#open?k=${key}&w=perch-3\n`)).toEqual(link);
    expect(parseWorkspaceLink(`#open?k=${key}&w=perch-a1b2c3`)).toEqual({ agentKey: key, workspaceId: 'perch-a1b2c3' });
  });

  it('refuses anything incomplete or malformed', () => {
    expect(parseWorkspaceLink(`#open?k=${key}`)).toBeNull();
    expect(parseWorkspaceLink(`#open?k=${key.slice(1)}&w=perch-3`)).toBeNull();
    expect(parseWorkspaceLink(`#open?k=${key}&w=a/b`)).toBeNull();
    expect(parseWorkspaceLink(`#pair?k=${key}&w=perch-3`)).toBeNull();
    expect(parseWorkspaceLink('https://tarfa.app/')).toBeNull();
  });

  it('never builds a link it would refuse', () => {
    expect(() => workspaceLink('https://tarfa.app', { agentKey: key, workspaceId: 'a b' })).toThrow();
    expect(() => workspaceLink('https://tarfa.app', { agentKey: 'short', workspaceId: 'perch-3' })).toThrow();
  });
});
