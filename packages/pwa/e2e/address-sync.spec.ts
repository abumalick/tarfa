import { test, expect, type Page } from '@playwright/test';
import { seedMachine, startFakeAgent, type FakeAgent } from './fake-agent';
import { failOnCspViolation } from './csp';

failOnCspViolation(test);

// An agent names its phone addresses on each accepted session; the phone adopts one only once it
// has connected through it, and a write (which reconnects) must leave the open terminal working.

let agent: FakeAgent;

test.beforeAll(async () => {
  agent = await startFakeAgent();
});
test.afterAll(async () => {
  await agent.close();
});

const stored = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('tarfa.machines') ?? '[]') as Array<{ addresses: string[] }>)[0]?.addresses);
const machineWrites = (page: Page) => page.evaluate(() => (window as unknown as { __machineWrites: number }).__machineWrites);

test('a listed address the phone cannot reach yet is adopted once the network comes back, and the open terminal comes back', async ({ page }) => {
  const alt = `${agent.url}alt`;
  agent.phoneAddresses = [alt, agent.url];
  let blocked = true;
  let dialed = 0;
  await page.routeWebSocket(alt, (ws) => {
    dialed += 1;
    if (blocked) ws.close();
    else ws.connectToServer();
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __machineWrites: number };
    w.__machineWrites = 0;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'tarfa.machines') w.__machineWrites += 1;
      return setItem.call(this, key, value);
    };
  });
  await seedMachine(page, agent);
  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  const rows = page.locator('.xterm-rows');
  await expect(rows.filter({ hasText: 'TARFA_READY' })).toBeVisible();

  await expect.poll(() => dialed).toBe(1);
  expect(await stored(page)).toEqual([agent.url]);

  await page.locator('.xterm-screen').click();
  await page.keyboard.type('ls\n');
  await expect(rows.filter({ hasText: 'echoed' })).toBeVisible();

  blocked = false;
  const before = await machineWrites(page);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => stored(page)).toEqual([alt, agent.url]);

  // The write reconnected the machine: the terminal re-attaches on its own and takes input.
  await expect(rows.filter({ hasText: 'echoed' })).toHaveCount(0);
  await expect(rows.filter({ hasText: 'TARFA_READY' })).toBeVisible();
  await page.locator('.xterm-screen').click();
  await page.keyboard.type('ls\n');
  await expect(rows.filter({ hasText: 'echoed' })).toBeVisible();

  // The session that write caused names the same list, and writes nothing more.
  await page.waitForTimeout(1000);
  expect(await machineWrites(page)).toBe(before + 1);
});
