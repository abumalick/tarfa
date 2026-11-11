import { test, expect, type Page } from '@playwright/test';
import { seedMachine, startFakeAgent, type FakeAgent } from './fake-agent';

let agent: FakeAgent;

test.beforeAll(async () => {
  agent = await startFakeAgent();
});
test.beforeEach(() => {
  agent.dictationKeys.elevenlabs = 'test-key-from-agent';
  delete agent.dictationKeys.openrouter;
  agent.takesKeys = true;
});
test.afterAll(async () => {
  await agent.close();
});

test.use({ viewport: { width: 390, height: 844 } });

function mic(page: Page) {
  return page.getByRole('toolbar', { name: 'Terminal keys' }).getByRole('button', { name: /^Dictate/ });
}

async function openMachinePage(page: Page) {
  await page.goto('/');
  await expect(page.getByText('demo', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Test/ }).click();
  await expect(page.getByRole('heading', { name: 'Test' })).toBeVisible();
}

test("the machine's stored key gives its workspaces a mic, and is never written to the device", async ({ page }) => {
  await seedMachine(page, agent);
  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'TARFA_READY' })).toBeVisible();
  await expect(mic(page)).toHaveAccessibleName('Dictate (Scribe v3), long press for presets');

  const stored = await page.evaluate(() => Object.keys(localStorage).map((k) => localStorage.getItem(k) ?? '').join('\n'));
  expect(stored).not.toContain('test-key-from-agent');
});

test('a key an older build stored on the device is deleted and not used', async ({ page }) => {
  delete agent.dictationKeys.elevenlabs;
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('tarfa.elevenLabsApiKey', 'sk-el-device');
      sessionStorage.setItem('seeded', '1');
    }
  });
  await seedMachine(page, agent);
  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.getByRole('toolbar', { name: 'Terminal keys' }).getByRole('button', { name: 'Set up dictation' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('tarfa.elevenLabsApiKey'))).toBeNull();
});

test('Settings names the machine that holds a key, and has no key field of its own', async ({ page }) => {
  await seedMachine(page, agent);
  await page.goto('/');
  await expect(page.getByText('demo', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByTestId('elevenlabs-key-source')).toHaveText('ElevenLabs: set on Test.');
  await expect(page.getByTestId('openrouter-key-source')).toHaveCount(0);
  await expect(page.getByLabel(/API key/)).toHaveCount(0);
});

test("a key set on the machine's page reaches the machine, and a removed one leaves it", async ({ page }) => {
  await seedMachine(page, agent);
  await openMachinePage(page);
  const openrouter = page.getByTestId('machine-key-openrouter');
  await expect(openrouter).toContainText('Not set');
  await expect(page.getByTestId('machine-key-elevenlabs')).toContainText('Set on this machine');
  await expect(page.getByLabel('ElevenLabs API key')).toHaveAttribute('placeholder', '••••••');
  await expect(page.getByLabel('ElevenLabs API key')).toHaveValue('');

  await page.getByLabel('OpenRouter API key').fill('sk-or-v1-testkey2testkey2testkey2testkey2testkey2');
  await openrouter.getByRole('button', { name: 'Save key' }).click();
  await expect(openrouter.getByRole('status')).toHaveText('Saved on Test ✓');
  await expect(openrouter).toContainText('Set on this machine');
  await expect(page.getByLabel('OpenRouter API key')).toHaveValue('');
  expect(agent.dictationKeys.openrouter).toBe('sk-or-v1-testkey2testkey2testkey2testkey2testkey2');
  expect(await page.evaluate(() => Object.values(localStorage).join('\n'))).not.toContain('sk-or-v1-testkey2testkey2testkey2testkey2testkey2');

  await page.getByLabel('OpenRouter API key').fill('two words');
  await openrouter.getByRole('button', { name: 'Save key' }).click();
  await expect(openrouter.getByRole('status')).toHaveText(
    'Not saved: this is not an OpenRouter key. An OpenRouter key starts with sk-or-v1- followed by at least 32 letters and digits.',
  );

  await openrouter.getByRole('button', { name: 'Remove' }).click();
  await expect(openrouter.getByRole('status')).toHaveText('Removed from Test');
  await expect(openrouter).toContainText('Not set');
  expect(agent.dictationKeys.openrouter).toBeUndefined();
});

test("an older agent's page asks for an update instead of offering a field", async ({ page }) => {
  agent.takesKeys = false;
  await seedMachine(page, agent);
  await openMachinePage(page);
  await expect(page.getByTestId('machine-keys-update')).toHaveText("Update this machine's agent to store a key here.");
  await expect(page.getByText('tarfa dictation-key set openrouter')).toBeVisible();
  await expect(page.getByTestId('machine-key-elevenlabs')).toContainText('Set on this machine');
  await expect(page.getByLabel(/API key/)).toHaveCount(0);
});

test("with no key anywhere, the setup sends the user to this machine's page", async ({ page }) => {
  delete agent.dictationKeys.elevenlabs;
  await seedMachine(page, agent);
  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'TARFA_READY' })).toBeVisible();
  await page.getByRole('toolbar', { name: 'Terminal keys' }).getByRole('button', { name: 'Set up dictation' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set up dictation' });
  await expect(dialog).toContainText("on this machine's page in Settings");
  await expect(dialog.getByText('tarfa dictation-key set elevenlabs')).toBeVisible();
  await dialog.getByRole('button', { name: "Open this machine's page at the OpenRouter key" }).click();
  await expect(page.getByRole('heading', { name: 'Test' })).toBeVisible();
  await expect(page.getByLabel('OpenRouter API key')).toBeFocused();
});
