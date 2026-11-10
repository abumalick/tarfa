import { test, expect, type Page } from '@playwright/test';
import { seedMachine, startFakeAgent, type FakeAgent } from './fake-agent';

let agent: FakeAgent;

test.beforeAll(async () => {
  agent = await startFakeAgent();
  agent.dictationKeys.elevenlabs = 'test-key-from-agent';
});
test.afterAll(async () => {
  await agent.close();
});

test.use({ viewport: { width: 390, height: 844 } });

function mic(page: Page) {
  return page.getByRole('toolbar', { name: 'Terminal keys' }).getByRole('button', { name: /^Dictate/ });
}

test("the machine's stored key gives its workspaces a mic, and is never written to the device", async ({ page }) => {
  await seedMachine(page, agent);
  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'TARFA_READY' })).toBeVisible();
  await expect(mic(page)).toHaveAccessibleName('Dictate (Scribe)');

  const stored = await page.evaluate(() => Object.keys(localStorage).map((k) => localStorage.getItem(k) ?? '').join('\n'));
  expect(stored).not.toContain('test-key-from-agent');
});

test('Settings names the machine that provides a key, and a typed key overrides it', async ({ page }) => {
  await seedMachine(page, agent);
  await page.goto('/');
  await expect(page.getByText('demo', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  const source = page.getByTestId('elevenlabs-key-source');
  await expect(source).toHaveText(/^Left empty, workspaces on .+ use the key their machine provides\.$/);
  await expect(page.getByTestId('openrouter-key-source')).toHaveCount(0);
  await expect(page.getByLabel('ElevenLabs API key')).toHaveValue('');

  await page.getByLabel('ElevenLabs API key').fill('typed-key');
  await page.getByRole('button', { name: 'Save key' }).first().click();
  await expect(source).toHaveText(/^Used everywhere, instead of the key from .+\.$/);
});

test('with no key anywhere, the setup offers storing one on the machine first', async ({ page }) => {
  const bare = await startFakeAgent();
  try {
    await seedMachine(page, bare);
    await page.goto('/');
    await page.getByText('demo', { exact: true }).click();
    await expect(page.locator('.xterm-rows').filter({ hasText: 'TARFA_READY' })).toBeVisible();
    await page.getByRole('toolbar', { name: 'Terminal keys' }).getByRole('button', { name: 'Set up dictation' }).click();
    const dialog = page.getByRole('dialog', { name: 'Set up dictation' });
    await expect(dialog.getByRole('heading', { level: 3 }).first()).toHaveText('A key on this machine');
    await expect(dialog.getByText('tarfa dictation-key set elevenlabs')).toBeVisible();
    await expect(dialog.getByText('tarfa dictation-key set openrouter')).toBeVisible();
  } finally {
    await bare.close();
  }
});
