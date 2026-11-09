import { test, expect } from '@playwright/test';
import { seedMachine, startFakeAgent, type FakeAgent } from './fake-agent';

let agent: FakeAgent;

const workspaces = Array.from({ length: 30 }, (_, i) => ({
  machineId: 'agent-machine-id',
  id: `ws-${i}`,
  name: `workspace-${i}`,
  projectPath: '/home/u/workspace/demo',
  command: 'bash',
  createdAt: 1,
  lastActivityAt: 1,
  status: 'idle',
}));

test.beforeAll(async () => {
  agent = await startFakeAgent(workspaces);
});
test.afterAll(async () => {
  await agent.close();
});

test.use({ viewport: { width: 390, height: 844 } });

// On a phone the list and the terminal share one page, so opening a workspace unmounts the
// list and the page's scroll is lost with it. Back must land where the user left the list.
test('back from a workspace returns to the list at the same scroll', async ({ page }) => {
  await seedMachine(page, agent, { defaultPath: '/home/u/workspace' });
  await page.goto('/');

  const row = page.locator('button.row', { hasText: 'workspace-20' });
  await row.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(200);

  await row.click();
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('button.row', { hasText: 'workspace-20' })).toBeVisible();

  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(before);
});
