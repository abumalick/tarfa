import { test, expect, type Page } from '@playwright/test';
import { seedMachine, startFakeAgent, type FakeAgent } from './fake-agent';
import { failOnCspViolation } from './csp';

failOnCspViolation(test);

let agent: FakeAgent;

test.beforeAll(async () => {
  agent = await startFakeAgent();
});
test.afterAll(async () => {
  await agent.close();
});

// The desktop path of openTerminalLink clicks a synthetic external anchor: capture its href.
async function spyOnAnchorOpens(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      (window as unknown as { __opened: string[] }).__opened.push(this.href);
    };
  });
  return () => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
}

test('a page the workspace asks to open shows as a card there, and Open opens it', async ({ page }) => {
  await seedMachine(page, agent);
  const opened = await spyOnAnchorOpens(page);
  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows')).toContainText('TARFA_READY perch-demo');

  agent.openUrl('perch-other', 'o1', 'https://elsewhere.example/');
  agent.openUrl('perch-demo', 'd1', 'https://claude.ai/code/artifact/3f2a?share=1');
  const card = page.getByTestId('open-url-card');
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId('open-url-host')).toHaveText('claude.ai');
  await expect(card).toContainText('/code/artifact/3f2a?share=1');
  await expect(card).toContainText('This workspace wants to open a page');

  // Above the terminal, not inside the keyboard bar: the card sits over the terminal's top.
  const cardBox = (await card.boundingBox())!;
  const termBox = (await page.locator('.term').boundingBox())!;
  expect(cardBox.y).toBeGreaterThanOrEqual(termBox.y);
  expect(cardBox.y).toBeLessThan(termBox.y + termBox.height / 2);

  await card.getByRole('button', { name: 'Open' }).click();
  await expect.poll(opened).toEqual(['https://claude.ai/code/artifact/3f2a?share=1']);
  await expect(card).toHaveCount(0);
  await expect.poll(() => agent.received.some((m) => m.type === 'openUrlDone' && m.id === 'd1')).toBe(true);
});

test('a dismissed card stays gone; one left unanswered comes back on the next visit', async ({ page }) => {
  agent.openUrl('perch-other', 'o2', 'https://elsewhere.example/');
  await seedMachine(page, agent);
  await page.goto('/');
  await page.getByText('other', { exact: true }).click();
  const card = page.getByTestId('open-url-card');
  await expect(card.getByTestId('open-url-host')).toHaveText('elsewhere.example');

  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByText('other', { exact: true }).click();
  await expect(card.getByTestId('open-url-host')).toHaveText('elsewhere.example');

  await card.getByRole('button', { name: 'Dismiss' }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByText('other', { exact: true }).click();
  await expect(page.locator('.xterm-rows')).toContainText('TARFA_READY perch-other');
  await expect(card).toHaveCount(0);
});
