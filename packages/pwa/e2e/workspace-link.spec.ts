import { test, expect } from '@playwright/test';
import { seedMachine, startFakeAgent, type FakeAgent } from './fake-agent';
import { failOnCspViolation } from './csp';

failOnCspViolation(test);

let agent: FakeAgent;
const fragment = (id: string) => `#open?k=${agent.agentKey}&w=${id}`;

test.beforeAll(async () => {
  agent = await startFakeAgent();
});
test.afterAll(async () => {
  await agent.close();
});

test('a launch with a workspace link opens that workspace and clears the address', async ({ page }) => {
  await seedMachine(page, agent);
  await page.goto(`/${fragment('perch-other')}`);
  await expect(page.getByTestId('header-name')).toHaveText('other');
  expect(await page.evaluate(() => location.hash)).toBe('');
});

test('a link reaching the open app (only the fragment changes) opens the workspace', async ({ page }) => {
  await seedMachine(page, agent);
  await page.goto('/');
  await expect(page.getByText('demo', { exact: true })).toBeVisible();
  await page.evaluate((hash) => (location.hash = hash), fragment('perch-demo'));
  await expect(page.getByTestId('header-name')).toHaveText('demo');
});

test('a link to a workspace the machine no longer has says so', async ({ page }) => {
  await seedMachine(page, agent);
  await page.goto(`/${fragment('perch-gone')}`);
  await expect(page.getByText('Workspace perch-gone is no longer on Test.')).toBeVisible();
});
