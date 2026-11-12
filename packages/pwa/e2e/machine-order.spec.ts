import { test, expect, type Page } from '@playwright/test';
import { dragBy } from './drag';
import { machineEntry, startFakeAgent, type FakeAgent } from './fake-agent';

// Reordering the machine list in Settings only rewrites the stored order: no connection is
// rebuilt, and the order is what the app reads back after a reload.

let alpha: FakeAgent;
let beta: FakeAgent;

test.beforeAll(async () => {
  alpha = await startFakeAgent();
  beta = await startFakeAgent();
});
test.afterAll(async () => {
  await alpha.close();
  await beta.close();
});

const machineNames = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('tarfa.machines') ?? '[]') as Array<{ name: string }>).map((m) => m.name));

test('machines are reordered by dragging in Settings, without reconnecting, and the order stays', async ({ page }) => {
  const entries = [await machineEntry(alpha, { id: 'alpha', name: 'Alpha' }), await machineEntry(beta, { id: 'beta', name: 'Beta' })];
  // Seeded once: a reload must read what the app stored, not the seed again.
  await page.addInitScript((m) => {
    if (!localStorage.getItem('tarfa.machines')) localStorage.setItem('tarfa.machines', JSON.stringify(m));
  }, entries);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: /^Alpha.*Online/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Beta.*Online/ })).toBeVisible();
  const upgrades = [alpha.upgrades, beta.upgrades];

  const betaRow = (await page.getByRole('button', { name: /^Beta/ }).boundingBox())!;
  await dragBy(page, page.getByRole('button', { name: 'Reorder Beta' }), -betaRow.height);

  const rows = page.getByRole('button', { name: /^(Alpha|Beta)/ });
  await expect(rows.first()).toHaveAccessibleName(/^Beta/);
  expect(await machineNames(page)).toEqual(['Beta', 'Alpha']);
  await expect(page.getByRole('button', { name: /^Alpha.*Online/ })).toBeVisible();
  await page.waitForTimeout(300);
  expect([alpha.upgrades, beta.upgrades]).toEqual(upgrades);

  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: /^(Alpha|Beta)/ }).first()).toHaveAccessibleName(/^Beta/);
});

test('a machine dropped back where it started changes nothing', async ({ page }) => {
  const entries = [await machineEntry(alpha, { id: 'alpha', name: 'Alpha' }), await machineEntry(beta, { id: 'beta', name: 'Beta' })];
  await page.addInitScript((m) => localStorage.setItem('tarfa.machines', JSON.stringify(m)), entries);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await dragBy(page, page.getByRole('button', { name: 'Reorder Alpha' }), 10);
  expect(await machineNames(page)).toEqual(['Alpha', 'Beta']);
});
