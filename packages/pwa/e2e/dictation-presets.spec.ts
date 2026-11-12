import { test, expect, type Page } from '@playwright/test';
import { seedMachine, startFakeAgent, type FakeAgent } from './fake-agent';
import { dragBy } from './drag';

let agent: FakeAgent;

test.beforeAll(async () => {
  agent = await startFakeAgent();
});
test.beforeEach(() => {
  delete agent.dictationKeys.elevenlabs;
  delete agent.dictationKeys.openrouter;
});
test.afterAll(async () => {
  await agent.close();
});

test.use({ viewport: { width: 390, height: 844 } });

async function openTerminal(page: Page) {
  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'TARFA_READY' })).toBeVisible();
}

function mic(page: Page) {
  return page.getByRole('toolbar', { name: 'Terminal keys' }).getByRole('button', { name: /^Dictate/ });
}

// Hold the mic past the long-press threshold with a real pointer, as a finger would.
async function holdMic(page: Page) {
  const box = (await mic(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
}

// Scroll the keyboard bar so `key`'s left edge lands at `left` px from the viewport's.
async function scrollBarTo(page: Page, key: ReturnType<Page['locator']>, left: number) {
  await key.evaluate((el, left) => {
    const bar = el.closest('[role="toolbar"]')!;
    bar.scrollLeft += el.getBoundingClientRect().left - left;
  }, left);
  const box = (await key.boundingBox())!;
  expect(box.x).toBeLessThan(60);
}

test("with nothing set up, the mic explains how, down to the key field on the machine's page", async ({ page }) => {
  await seedMachine(page, agent);
  await openTerminal(page);
  const setup = page.getByRole('toolbar', { name: 'Terminal keys' }).getByRole('button', { name: 'Set up dictation' });
  await expect(setup).toBeVisible();
  await setup.click();

  const dialog = page.getByRole('dialog', { name: 'Set up dictation' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('if this machine runs Linux');
  await expect(dialog.getByRole('link', { name: 'Machine setup guide' })).toHaveAttribute(
    'href',
    /github\.com\/abumalick\/tarfa\/blob\/main\/docs\/SETUP-MACHINE\.md#11-/,
  );
  await expect(dialog.getByRole('heading', { name: 'ElevenLabs' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'OpenRouter' })).toBeVisible();

  await dialog.getByRole('button', { name: 'How to get an ElevenLabs key' }).click();
  const help = page.getByRole('dialog', { name: 'Get an ElevenLabs key' });
  await expect(help).toContainText('$0.22 per hour');
  await expect(help.getByRole('link', { name: 'Open the API keys page' })).toHaveAttribute('href', 'https://elevenlabs.io/app/developers/api-keys');
  await help.getByRole('button', { name: "Open this machine's page" }).click();

  await expect(page.getByRole('heading', { name: 'Test' })).toBeVisible();
  await expect(page.getByLabel('ElevenLabs API key')).toBeInViewport();
});

test('where the machine has Claude voice, the explanation says why this workspace cannot use it', async ({ page }) => {
  agent.claudeVoice = true;
  try {
    await seedMachine(page, agent);
    await openTerminal(page);
    await page.getByRole('toolbar', { name: 'Terminal keys' }).getByRole('button', { name: 'Set up dictation' }).click();
    const dialog = page.getByRole('dialog', { name: 'Set up dictation' });
    await expect(dialog).toContainText('in a Claude Code workspace');
    await expect(dialog.getByRole('link', { name: 'Machine setup guide' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  } finally {
    agent.claudeVoice = false;
  }
});

test('the mic shows the current preset, and a long press opens the presets on screen', async ({ page }) => {
  agent.dictationKeys.elevenlabs = 'sk-el-test';
  await seedMachine(page, agent);
  await openTerminal(page);
  await expect(mic(page)).toHaveAccessibleName('Dictate (Scribe v3), long press for presets');
  await expect(mic(page)).toContainText('EL3');

  await holdMic(page);
  const menu = page.getByRole('listbox', { name: 'Dictation presets' });
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await expect(menu.getByRole('option', { name: /Clean up/ })).toContainText('needs key');
  await expect(menu.getByRole('option', { name: /Clean up/ })).toBeDisabled();
  // The press ended when the menu opened, though the finger lifted over the backdrop.
  await expect(mic(page)).not.toHaveClass(/pressed/);
});

test('with the bar scrolled so the mic sits at the left edge, the presets stay on screen', async ({ page }) => {
  agent.dictationKeys.elevenlabs = 'sk-el-test';
  await seedMachine(page, agent);
  await openTerminal(page);
  await scrollBarTo(page, mic(page), 4);

  await holdMic(page);
  const menu = page.locator('.menu').filter({ has: page.getByRole('listbox', { name: 'Dictation presets' }) });
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});

test('picking a preset changes the badge and survives a reload', async ({ page }) => {
  agent.dictationKeys.openrouter = 'sk-or-test';
  await seedMachine(page, agent);
  await openTerminal(page);

  await holdMic(page);
  await page.getByRole('option', { name: /Clean up/ }).click();
  await expect(page.getByRole('listbox', { name: 'Dictation presets' })).toHaveCount(0);
  await expect(mic(page)).toHaveAccessibleName('Dictate (Clean up), long press for presets');
  await expect(mic(page)).toContainText('CL');

  await openTerminal(page);
  await expect(mic(page)).toContainText('CL');
});

test('a preset added in Settings is offered by the mic', async ({ page }) => {
  agent.dictationKeys.openrouter = 'sk-or-test';
  await seedMachine(page, agent);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Add preset' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Translate');
  await page.getByLabel('Badge').fill('TR');
  await page.getByRole('button', { name: 'Save preset' }).click();
  await expect(page.getByRole('button', { name: /Edit Translate/ })).toBeVisible();

  await openTerminal(page);
  await holdMic(page);
  await expect(page.getByRole('option', { name: /Translate/ })).toContainText('TR');
});

test("the mic menu's Add preset opens a new preset in Settings, above the highlighted list", async ({ page }) => {
  agent.dictationKeys.openrouter = 'sk-or-test';
  await page.addInitScript(() => localStorage.setItem('tarfa.dictationPreset', 'fast'));
  await seedMachine(page, agent);
  await openTerminal(page);
  await holdMic(page);
  await page.getByRole('button', { name: 'Add preset…' }).click();

  const dialog = page.getByRole('dialog', { name: 'New preset' });
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(844);

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('li[aria-current="true"]')).toContainText('Fast');
});

test('a Claude voice preset falls back on a machine whose agent cannot do Claude voice', async ({ page }) => {
  const claudeAgent = await startFakeAgent([
    { machineId: 'agent-machine-id', id: 'perch-demo', name: 'demo', projectPath: '/home/u/workspace/demo', command: 'claude', createdAt: 1, lastActivityAt: 1, status: 'idle' },
  ]);
  try {
    claudeAgent.dictationKeys.elevenlabs = 'sk-el-test';
    await page.addInitScript(() => {
      localStorage.setItem(
        'tarfa.dictationPresets',
        JSON.stringify([
          { id: 'scribe', name: 'Scribe', badge: 'EL', provider: 'elevenlabs' },
          { id: 'cv', name: 'Claude voice', badge: 'CV', provider: 'claude', fallbackId: 'scribe' },
        ]),
      );
      localStorage.setItem('tarfa.dictationPreset', 'cv');
    });
    await seedMachine(page, claudeAgent);
    await openTerminal(page);
    await expect(mic(page)).toHaveAccessibleName('Dictate (Scribe), long press for presets');
    await holdMic(page);
    const option = page.getByRole('option', { name: /Claude voice/ });
    await expect(option).toContainText('not on this machine');
    await expect(option).toBeDisabled();

    claudeAgent.claudeVoice = true;
    await openTerminal(page);
    await expect(mic(page)).toHaveAccessibleName('Dictate (Claude voice), long press for presets');
  } finally {
    await claudeAgent.close();
  }
});

test('out of the box, Claude voice is the mic where the machine can do it, and Scribe v3 elsewhere', async ({ page }) => {
  const claudeAgent = await startFakeAgent([
    { machineId: 'agent-machine-id', id: 'perch-demo', name: 'demo', projectPath: '/home/u/workspace/demo', command: 'claude', createdAt: 1, lastActivityAt: 1, status: 'idle' },
  ]);
  try {
    claudeAgent.claudeVoice = true;
    await seedMachine(page, claudeAgent);
    await openTerminal(page);
    await expect(mic(page)).toHaveAccessibleName('Dictate (Claude voice), long press for presets');
    await expect(mic(page)).toContainText('CV');

    claudeAgent.dictationKeys.elevenlabs = 'sk-el-test';
    claudeAgent.claudeVoice = false;
    await openTerminal(page);
    await expect(mic(page)).toHaveAccessibleName('Dictate (Scribe v3), long press for presets');
  } finally {
    await claudeAgent.close();
  }
});

test('presets are reordered by dragging their grip in Settings', async ({ page }) => {
  await seedMachine(page, agent);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const names = () => page.locator('.presets [data-sort-row] .label').allTextContents();
  const before = await names();
  const row = (await page.locator('.presets [data-sort-row]').first().boundingBox())!;
  await dragBy(page, page.getByRole('button', { name: `Reorder ${before[0]}` }), row.height * 1.6);
  await expect.poll(names).toEqual([before[1], before[2], before[0], ...before.slice(3)]);
  const stored = await page.evaluate(() => (JSON.parse(localStorage.getItem('tarfa.dictationPresets') ?? '[]') as Array<{ name: string }>).map((p) => p.name));
  expect(stored).toEqual(await names());
});

test('a preset dropped back where it started keeps the built-in defaults', async ({ page }) => {
  await seedMachine(page, agent);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const first = await page.locator('.presets [data-sort-row] .label').first().textContent();
  await dragBy(page, page.getByRole('button', { name: `Reorder ${first}` }), 10);
  expect(await page.evaluate(() => localStorage.getItem('tarfa.dictationPresets'))).toBeNull();
});
