import { describe, expect, it } from 'vitest';
import type { TmuxPort, TmuxSessionInfo } from '../ports/tmux-port.js';
import { OpenRequests } from './open-requests.js';
import { openUrl } from './open-url.js';

const session = (name: string, o: Partial<TmuxSessionInfo> = {}): TmuxSessionInfo => ({ startPath: '/w', command: 'claude', createdAt: 0, title: '', ...o, name });

function setup(opts: { ancestor?: boolean } = {}) {
  const tmux = {
    listSessions: async () => [session('perch-p'), session('perch-c', { command: 'codex', codexThread: 't-1' })],
    sessionOfPane: async (pane: string) => ({ '%1': 'perch-p', '%9': 'other' })[pane] ?? null,
    pidOfPane: async () => 100,
  } as unknown as TmuxPort;
  const requests = new OpenRequests();
  const pushed: Array<{ workspaceId: string; id: string; url: string }> = [];
  const deps = {
    tmux,
    ancestry: { isAncestor: async () => opts.ancestor ?? true },
    sessionPrefix: 'perch-',
    requests,
    push: (workspaceId: string, request: { id: string; url: string }) => pushed.push({ workspaceId, ...request }),
  };
  return { deps, requests, pushed };
}

describe('openUrl', () => {
  it('keeps the page for the calling workspace and pushes it', async () => {
    const t = setup();
    expect(await openUrl(t.deps, { pane: '%1', pid: 200, url: 'https://claude.ai/a' })).toEqual({ result: 'shown' });
    expect(t.requests.get('perch-p')?.url).toBe('https://claude.ai/a');
    expect(t.pushed).toEqual([{ workspaceId: 'perch-p', id: t.requests.get('perch-p')!.id, url: 'https://claude.ai/a' }]);
  });

  it('names the workspace of a Codex thread', async () => {
    const t = setup();
    expect(await openUrl(t.deps, { pane: '', pid: 200, url: 'https://a.example/', codexThread: 't-1' })).toEqual({ result: 'shown' });
    expect(t.requests.get('perch-c')).toBeDefined();
  });

  it('does not push the same page twice', async () => {
    const t = setup();
    await openUrl(t.deps, { pane: '%1', pid: 200, url: 'https://claude.ai/a' });
    expect(await openUrl(t.deps, { pane: '%1', pid: 200, url: 'https://claude.ai/a' })).toEqual({ result: 'shown' });
    expect(t.pushed).toHaveLength(1);
  });

  it('refuses anything but a plain web page', async () => {
    const t = setup();
    expect(await openUrl(t.deps, { pane: '%1', pid: 200, url: 'javascript:alert(1)' })).toEqual({ result: 'refused', reason: 'not a web page' });
    expect(await openUrl(t.deps, { pane: '%1', pid: 200, url: '/home/u/report.pdf' })).toEqual({ result: 'refused', reason: 'not a web page' });
    expect(t.pushed).toHaveLength(0);
  });

  it('refuses a caller outside a Tarfa workspace', async () => {
    expect(await openUrl(setup().deps, { pane: '%9', pid: 200, url: 'https://a.example/' })).toEqual({ result: 'refused', reason: 'not run from a Tarfa workspace' });
    const t = setup({ ancestor: false });
    expect(await openUrl(t.deps, { pane: '%1', pid: 200, url: 'https://a.example/' })).toEqual({ result: 'refused', reason: 'not run from a Tarfa workspace' });
    expect(t.pushed).toHaveLength(0);
  });
});
