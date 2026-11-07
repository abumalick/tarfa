import { describe, expect, it } from 'vitest';
import { npmRegistry } from './npm-registry';

const answer = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('npmRegistry', () => {
  it('reads the latest dist-tag', async () => {
    let asked = '';
    const fetchFn = (async (url: string) => ((asked = url), new Response(JSON.stringify({ 'dist-tags': { latest: '0.2.0' } })))) as unknown as typeof fetch;
    expect(await npmRegistry({ fetch: fetchFn }).latest()).toBe('0.2.0');
    expect(asked).toBe('https://registry.npmjs.org/@tarfa/cli');
    expect(await npmRegistry({ fetch: fetchFn, registry: 'http://127.0.0.1:1/' }).latest()).toBe('0.2.0');
    expect(asked).toBe('http://127.0.0.1:1/@tarfa/cli');
  });

  it('fails with a reason on a bad status, a body without a tag, and a network error', async () => {
    await expect(npmRegistry({ fetch: answer({}, 503) }).latest()).rejects.toThrow(/503/);
    await expect(npmRegistry({ fetch: answer({ 'dist-tags': {} }) }).latest()).rejects.toThrow(/no latest/);
    const down = (async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); }) as unknown as typeof fetch;
    await expect(npmRegistry({ fetch: down }).latest()).rejects.toThrow('ECONNREFUSED');
  });

  it('gives up after the timeout', async () => {
    const hang = ((_url: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch;
    await expect(npmRegistry({ fetch: hang, timeoutMs: 20 }).latest()).rejects.toThrow('aborted');
  });
});
