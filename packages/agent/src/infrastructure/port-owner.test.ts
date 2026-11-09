import { createServer, type Server } from 'node:net';
import { describe, expect, it } from 'vitest';
import { portOwner } from './port-owner';

function listen(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port }));
  });
}

describe('portOwner', () => {
  it('reads a port nobody holds as free', async () => {
    const { server, port } = await listen();
    await new Promise((resolve) => server.close(resolve));
    expect(await portOwner(port)).toBe('free');
  });

  it('reads a port held by a process that is not the agent as another\'s', async () => {
    const { server, port } = await listen();
    try {
      expect(await portOwner(port)).toBe('other');
    } finally {
      server.close();
    }
  });

  // A listener the fakes describe, on a real taken port so the free check says taken.
  async function owner(platform: NodeJS.Platform, answers: { lsof?: string; ss?: string; ps?: string; cgroup?: string }) {
    const { server, port } = await listen();
    try {
      return await portOwner(port, platform, {
        exec: async (command) => {
          const out = answers[command as 'lsof' | 'ss' | 'ps'];
          if (out === undefined) throw new Error(`${command} failed`);
          return out;
        },
        readFile: async () => {
          if (answers.cgroup === undefined) throw new Error('ENOENT');
          return answers.cgroup;
        },
      });
    } finally {
      server.close();
    }
  }

  it('counts the agent the launcher runs under launchd as ours', async () => {
    const lsof = '4242\n';
    expect(await owner('darwin', { lsof, ps: '/Users/u/.local/share/mise/installs/node/24/bin/node /Users/u/.local/share/mise/installs/npm-tarfa-cli/0.1.0/bin/tarfa serve\n' })).toBe('ours');
    expect(await owner('darwin', { lsof, ps: 'node /Users/u/workspace/tarfa/node_modules/.bin/tsx src/serve.ts\n' })).toBe('ours');
    expect(await owner('darwin', { lsof, ps: '/Users/u/.local/share/mise/installs/node/24/bin/node /Users/u/.local/share/mise/installs/npm-tarfa-cli/0.1.3/node_modules/@tarfa/cli/dist/cli.js serve\n' })).toBe('ours');
    expect(await owner('darwin', { lsof, ps: 'node /Users/u/.local/share/mise/installs/npm-tarfa-cli/0.1.3/node_modules/.bin/../.mise/@tarfa+cli@0.1.3/node_modules/@tarfa/cli/dist/cli.js serve\n' })).toBe('ours');
    expect(await owner('darwin', { lsof, ps: 'tarfa serve\n' })).toBe('ours');
    expect(await owner('darwin', { lsof, ps: 'node /Users/u/.local/share/mise/installs/npm-tarfa-cli/0.1.3/node_modules/@tarfa/cli/dist/cli.js ls\n' })).toBe('other');
    expect(await owner('darwin', { lsof, ps: 'python3 -m http.server 8797\n' })).toBe('other');
    expect(await owner('darwin', { lsof, ps: 'node /srv/notarfa serve\n' })).toBe('other');
    expect(await owner('darwin', { lsof: '' })).toBe('other');
  });

  it('counts a listener in the agent unit\'s cgroup as ours under systemd, under either name', async () => {
    const ss = 'LISTEN 0 511 127.0.0.1:8797 0.0.0.0:* users:(("node",pid=4242,fd=21))\n';
    expect(await owner('linux', { ss, cgroup: '0::/user.slice/user-1000.slice/user@1000.service/app.slice/tarfa-agent.service\n' })).toBe('ours');
    expect(await owner('linux', { ss, cgroup: '0::/user.slice/user-1000.slice/user@1000.service/app.slice/perch-agent.service\n' })).toBe('ours');
    expect(await owner('linux', { ss, cgroup: '0::/user.slice/user-1000.slice/user@1000.service/tmux-spawn-1.scope\n' })).toBe('other');
    expect(await owner('linux', { ss: '' })).toBe('other');
  });
});
