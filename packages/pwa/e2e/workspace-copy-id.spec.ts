import { test, expect } from '@playwright/test';
import { seedMachine, startFakeAgent, type FakeAgent } from './fake-agent';

let agent: FakeAgent;

test.beforeAll(async () => {
  agent = await startFakeAgent();
});
test.afterAll(async () => {
  await agent.close();
});

test('a long press on a workspace copies its id and leaves the list open', async ({ page }) => {
  await seedMachine(page, agent);
  await page.goto('/');
  const row = page.getByRole('button', { name: /demo/ }).first();
  await expect(row).toBeVisible();

  await page.evaluate(() => {
    const w = window as unknown as { __copied: string[] };
    w.__copied = [];
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: (t: string) => (w.__copied.push(t), Promise.resolve()),
    });
  });

  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(row).toHaveAttribute('data-held', '');
  await page.mouse.up();

  await expect(page.getByTestId('copy-id-notice')).toHaveText('Copied perch-demo');
  expect(await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual(['perch-demo']);
  // An open marks the row current at once; give a swallowed click time to have gone through.
  await page.waitForTimeout(300);
  await expect(row).not.toHaveAttribute('aria-current', 'true');
  await expect(row).toBeVisible();
});
