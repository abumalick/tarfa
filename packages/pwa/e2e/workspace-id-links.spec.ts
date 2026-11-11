import { test, expect } from '@playwright/test';
import { seedMachine, startFakeAgent, type FakeAgent } from './fake-agent';
import { failOnCspViolation } from './csp';

failOnCspViolation(test);

let agent: FakeAgent;

const at = (id: string, name: string, lastActivityAt: number, status = 'idle') => ({
  machineId: 'agent-machine-id',
  id,
  name,
  projectPath: `/home/u/workspace/${name}`,
  command: 'claude',
  createdAt: 1,
  lastActivityAt,
  status,
});

test.beforeAll(async () => {
  const now = Date.now();
  agent = await startFakeAgent([
    at('perch-a1b2c3', 'source', now - 5 * 60_000),
    at('perch-d4e5f6', 'target', now - 3 * 3_600_000 - 60_000),
    at('perch-e7e7e7', 'resting', now, 'parked'),
  ]);
});
test.afterAll(async () => {
  await agent.close();
});

test.describe('touch (iOS)', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  });

  test('tapping a listed workspace id in the terminal opens that workspace', async ({ page }) => {
    await seedMachine(page, agent);
    await page.goto('/');
    await page.getByText('source', { exact: true }).tap();
    await expect(page.getByTestId('header-name')).toHaveText('source');
    await expect(page.locator('.xterm-rows').filter({ hasText: 'TARFA_READY perch-a1b2c3' })).toBeVisible();

    // Coloured, so each id gets its own span to tap.
    agent.sendOutput('perch-a1b2c3', 'unknown \x1b[32mperch-999999\x1b[0m\r\nparked \x1b[32mperch-e7e7e7\x1b[0m\r\nspawned \x1b[32mperch-d4e5f6\x1b[0m\r\n');
    const unknown = page.locator('.xterm-rows').getByText('perch-999999', { exact: true });
    await unknown.tap();
    await expect(page.getByTestId('header-name')).toHaveText('source');
    // Opening a parked workspace would unpark it and start Claude: not on a stray tap.
    await page.locator('.xterm-rows').getByText('perch-e7e7e7', { exact: true }).tap();
    await expect(page.getByTestId('header-name')).toHaveText('source');

    await page.locator('.xterm-rows').getByText('perch-d4e5f6', { exact: true }).tap();
    await expect(page.getByTestId('header-name')).toHaveText('target');
    await expect(page.locator('.xterm-rows').filter({ hasText: 'TARFA_READY perch-d4e5f6' })).toBeVisible();
  });
});

test('a tappable workspace id stays underlined, in either screen, and only while it is one', async ({ page }) => {
  await seedMachine(page, agent);
  await page.goto('/');
  await page.getByText('source', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'TARFA_READY perch-a1b2c3' })).toBeVisible();
  const bars = page.locator('.workspace-id-underlines > div');
  const rows = page.locator('.xterm-rows');
  // Its own id, an unknown one and a parked one are not links.
  await expect(bars).toHaveCount(0);

  // xterm's rows and the bars are rebuilt as output lands, so a box can be read off a detached node.
  const underId = (id: string) =>
    expect(async () => {
      const span = await rows.getByText(id, { exact: true }).boundingBox();
      const bar = await bars.first().boundingBox();
      expect(span && bar).toBeTruthy();
      expect(Math.abs(bar!.x - span!.x)).toBeLessThan(1.5);
      expect(Math.abs(bar!.width - span!.width)).toBeLessThan(1.5);
      expect(bar!.y).toBeGreaterThan(span!.y);
      expect(bar!.y).toBeLessThanOrEqual(span!.y + span!.height + 1);
    }).toPass({ timeout: 5000 });

  agent.sendOutput('perch-a1b2c3', 'unknown \x1b[32mperch-999999\x1b[0m parked \x1b[32mperch-e7e7e7\x1b[0m spawned \x1b[32mperch-d4e5f6\x1b[0m\r\n');
  await expect(bars).toHaveCount(1);
  await underId('perch-d4e5f6');

  // Scrolled off the screen, the line takes its underline with it.
  agent.sendOutput('perch-a1b2c3', 'line\r\n'.repeat(80));
  await expect(bars).toHaveCount(0);

  // A tmux client draws in the alternate screen, where xterm's own decorations do not exist.
  agent.sendOutput('perch-a1b2c3', '\x1b[?1049h\x1b[2J\x1b[H\x1b[3;5Hsee \x1b[32mperch-d4e5f6\x1b[0m');
  await expect(bars).toHaveCount(1);
  await underId('perch-d4e5f6');
});
