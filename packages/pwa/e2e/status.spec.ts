import { test, expect } from '@playwright/test';
import { seedMachine, startFakeAgent, type FakeAgent } from './fake-agent';

let agent: FakeAgent;

test.beforeAll(async () => {
  agent = await startFakeAgent();
});
test.afterAll(async () => {
  await agent.close();
});

// Switching a workspace's status from the terminal header picker re-sorts the list: setting
// it to "Blocked" folds it under a Blocked line at the bottom; setting it back to "Needs you"
// lifts it to the top again. (Default 1280px viewport keeps the list visible as a sidebar while
// the terminal is open.)
test('status picker re-sorts the workspace; blocked folds it last', async ({ page }) => {
  await seedMachine(page, agent);
  await page.goto('/');

  const rowNames = page.locator('.row .name');
  // Initial order: demo (needs-feedback) is first, other (idle) last.
  await expect(rowNames).toHaveText(['demo', 'other']);

  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'TARFA_READY' })).toBeVisible();

  // The header pill shows the current status; open it and pick Blocked.
  await page.getByRole('button', { name: /status: needs you/i }).click();
  await page.getByRole('option', { name: /blocked/i }).click();

  // demo now sits folded under a Blocked line, below the idle workspace.
  const blocked = page.getByRole('button', { name: '1 · Blocked' });
  await expect(blocked).toBeVisible();
  await expect(rowNames).toHaveText(['other']);
  await blocked.click();
  await expect(page.locator('.badge', { hasText: 'Blocked' })).toBeVisible();
  await expect(rowNames).toHaveText(['other', 'demo']);

  // The pill now reads Blocked; switch back to Needs you to restore demo to the top.
  await page.getByRole('button', { name: /status: blocked/i }).click();
  await page.getByRole('option', { name: /needs you/i }).click();
  await expect(page.locator('.badge', { hasText: 'Blocked' })).toHaveCount(0);
  await expect(rowNames).toHaveText(['demo', 'other']);
});
