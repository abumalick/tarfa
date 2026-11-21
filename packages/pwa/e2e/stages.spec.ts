import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_WORKSPACES, seedMachine, startFakeAgent, type FakeAgent } from './fake-agent';
import { openWorkspaceMenu } from './drawer';

// The stages view is a setting, off by default.
const stagesOn = (page: Page) => page.addInitScript(() => localStorage.setItem('tarfa.stagesView', '1'));

const STAGES = [
  { name: 'In progress', kind: 'active' as const },
  { name: 'In review', kind: 'waiting' as const },
  { name: 'Done', kind: 'done' as const },
];

test.describe('against an agent with stages', () => {
  let agent: FakeAgent;
  test.beforeAll(async () => {
    const [demo, other] = DEFAULT_WORKSPACES.map((w) => ({ ...w }));
    agent = await startFakeAgent([
      { ...demo!, stage: { name: 'In review', kind: 'waiting', since: 1 } },
      { ...other!, stage: { name: 'In progress', kind: 'active', since: 1 } },
    ]);
    agent.stages = STAGES;
  });
  test.afterAll(async () => {
    await agent.close();
  });

  // The phone path: the picker sits in the ☰ drawer. A waiting pick on a row that needs you also
  // marks it seen, so the row leaves Needs you and moves under its stage in one tap.
  test('a needs-you row moves under its stage once picked from the menu', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await stagesOn(page);
    await seedMachine(page, agent);
    await page.goto('/');

    const needsYou = page.getByRole('group', { name: /^needs you/i });
    await expect(needsYou.locator('.name')).toHaveText(['demo']);
    await expect(needsYou.locator('.stage')).toHaveText(['In review']);
    await expect(page.locator('.row .name')).toHaveText(['demo', 'other']);

    await page.getByText('demo', { exact: true }).click();
    await expect(page.locator('.xterm-rows').filter({ hasText: 'TARFA_READY' })).toBeVisible();
    await openWorkspaceMenu(page);
    await page.getByRole('button', { name: /status: needs you/i }).click();
    await expect(page.getByRole('group', { name: 'Stage' }).getByRole('option')).toHaveText([
      /In progress/,
      /In review/,
      /Done/,
    ]);
    await expect(page.getByRole('group', { name: 'Activity' }).getByRole('option')).toHaveText([
      /Seen/,
      /Needs hands/,
      /Park/,
    ]);
    await page.getByRole('option', { name: /in review/i }).click();

    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Back' }).click();

    await expect(needsYou).toHaveCount(0);
    const line = page.getByRole('button', { name: '1 · In review' });
    await expect(line).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.row .name')).toHaveText(['other', 'demo']);
    await line.click();
    await expect(page.locator('.row .name')).toHaveText(['other']);
    expect(agent.received).toContainEqual({ type: 'setStage', workspaceId: 'perch-demo', stage: 'In review' });
  });
});

// A turn that ended on `tarfa stage <waiting stage>` stays `working` with `waiting`: it reads
// "Waiting" and sits under its stage, never under Needs you.
test.describe('a turn that ended on a waiting stage', () => {
  let agent: FakeAgent;
  test.beforeAll(async () => {
    const [demo, other] = DEFAULT_WORKSPACES.map((w) => ({ ...w }));
    agent = await startFakeAgent([
      { ...demo!, status: 'working', waiting: true, stage: { name: 'In review', kind: 'waiting', since: 1 } },
      other!,
    ]);
    agent.stages = STAGES;
  });
  test.afterAll(async () => {
    await agent.close();
  });

  test('reads Waiting, under its stage', async ({ page }) => {
    await stagesOn(page);
    await seedMachine(page, agent);
    await page.goto('/');

    await expect(page.getByRole('button', { name: '1 · In review' })).toBeVisible();
    await expect(page.getByRole('group', { name: /^needs you/i })).toHaveCount(0);
    await expect(page.locator('.row .name')).toHaveText(['other', 'demo']);
    const demo = page.locator('.row').filter({ hasText: 'demo' });
    await expect(demo.locator('.badge')).toHaveText('Waiting');
  });
});

test.describe('against an agent without stages', () => {
  let agent: FakeAgent;
  test.beforeAll(async () => {
    agent = await startFakeAgent();
  });
  test.afterAll(async () => {
    await agent.close();
  });

  test("keeps today's status picker", async ({ page }) => {
    await stagesOn(page);
    await seedMachine(page, agent);
    await page.goto('/');
    await page.getByText('demo', { exact: true }).click();
    await expect(page.locator('.xterm-rows').filter({ hasText: 'TARFA_READY' })).toBeVisible();
    await page.getByRole('button', { name: /status: needs you/i }).click();
    await expect(page.getByRole('option')).toHaveCount(8);
    await expect(page.getByRole('group', { name: 'Stage' })).toHaveCount(0);
  });
});

test.describe('with the stages setting off', () => {
  let agent: FakeAgent;
  test.beforeAll(async () => {
    const [demo, other] = DEFAULT_WORKSPACES.map((w) => ({ ...w }));
    agent = await startFakeAgent([{ ...demo!, stage: { name: 'In review', kind: 'waiting', since: 1 } }, other!]);
    agent.stages = STAGES;
  });
  test.afterAll(async () => {
    await agent.close();
  });

  test("keeps today's list and picker against an agent with stages", async ({ page }) => {
    await seedMachine(page, agent);
    await page.goto('/');
    await expect(page.locator('.row .name')).toHaveText(['demo', 'other']);
    await expect(page.getByRole('group', { name: /^needs you/i })).toHaveCount(0);
    await expect(page.locator('.stage')).toHaveCount(0);
    await page.getByText('demo', { exact: true }).click();
    await expect(page.locator('.xterm-rows').filter({ hasText: 'TARFA_READY' })).toBeVisible();
    await page.getByRole('button', { name: /status: needs you/i }).click();
    await expect(page.getByRole('option')).toHaveCount(8);
    await expect(page.getByRole('group', { name: 'Stage' })).toHaveCount(0);
  });
});
