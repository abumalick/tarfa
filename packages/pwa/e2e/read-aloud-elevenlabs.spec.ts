import { test, expect, type Page, type Route } from '@playwright/test';
import { DEFAULT_WORKSPACES, seedMachine, startFakeAgent, type FakeAgent } from './fake-agent';
import { fakeVoice } from './fake-voice';
import { failOnCspViolation } from './csp';

let agent: FakeAgent;

test.beforeAll(async () => {
  agent = await startFakeAgent(DEFAULT_WORKSPACES.map((w) => ({ ...w, command: 'claude' })));
  agent.lastReplies['perch-demo'] = 'The build is green. Two tests were added.';
});
test.beforeEach(() => {
  agent.dictationKeys.elevenlabs = 'test-tts-key';
});
test.afterAll(async () => {
  await agent.close();
});

failOnCspViolation(test);

// Two seconds of 8 kHz silence: a clip WebKit decodes, with a known duration.
function wav(seconds: number): Buffer {
  const samples = 8000 * seconds;
  const b = Buffer.alloc(44 + samples, 128);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + samples, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(8000, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write('data', 36);
  b.writeUInt32LE(samples, 40);
  return b;
}

type Synthesis = { url: string; key: string | null; body: { text: string; model_id: string; language_code: string } };

async function fakeElevenLabs(page: Page, answer: (route: Route) => Promise<void> = (route) => route.fulfill({ body: wav(2), contentType: 'audio/mpeg' })) {
  const requests: Synthesis[] = [];
  await page.route('https://api.elevenlabs.io/v1/text-to-speech/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    requests.push({ url: request.url(), key: request.headers()['xi-api-key'] ?? null, body: request.postDataJSON() });
    await answer(route);
  });
  await page.route('https://api.elevenlabs.io/v2/voices**', (route) =>
    route.fulfill({
      json: {
        voices: [
          { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', labels: { accent: 'british' }, preview_url: null },
          { voice_id: 'ann-1', name: 'Ann', labels: { accent: 'american', gender: 'female' }, preview_url: null },
        ],
        has_more: false,
      },
      headers: { 'access-control-allow-origin': '*' },
    }),
  );
  return requests;
}

async function openDemo(page: Page) {
  await seedMachine(page, agent);
  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'TARFA_READY' })).toBeVisible();
}

const speaker = (page: Page) => page.getByRole('toolbar', { name: 'Terminal keys' }).getByRole('button', { name: 'Listen to the last reply' });

async function longPress(page: Page) {
  const box = (await speaker(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
}

async function pickElevenLabs(page: Page) {
  await longPress(page);
  await page.getByRole('option', { name: /ElevenLabs/ }).click();
  await expect(speaker(page)).toContainText('EL');
}

test('reads the last reply with ElevenLabs, with the player controls', async ({ page }) => {
  await fakeVoice(page);
  const requests = await fakeElevenLabs(page);
  await openDemo(page);
  await expect(speaker(page)).toContainText('📱');
  await pickElevenLabs(page);
  await speaker(page).click();
  const player = page.getByTestId('read-aloud-player');
  await expect(player.getByRole('button', { name: 'Pause' })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]!.url).toContain('/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb');
  expect(requests[0]!.key).toBe('test-tts-key');
  expect(requests[0]!.body).toEqual({ text: 'The build is green.\nTwo tests were added.', model_id: 'eleven_flash_v2_5', language_code: 'en' });
  await expect(player).toContainText('/ 0:02');
  await player.getByRole('button', { name: 'Pause' }).click();
  await expect(player.getByRole('button', { name: 'Play' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { spoken: string[] }).spoken)).toEqual([]);
  // Remembered on the device.
  await page.reload();
  await page.getByText('demo', { exact: true }).click();
  await expect(speaker(page)).toContainText('EL');
});

test('falls back to the phone voice, saying why, when ElevenLabs refuses', async ({ page }) => {
  await fakeVoice(page);
  await fakeElevenLabs(page, (route) =>
    route.fulfill({ status: 401, json: { detail: { status: 'quota_exceeded' } }, headers: { 'access-control-allow-origin': '*' } }),
  );
  await openDemo(page);
  await pickElevenLabs(page);
  await speaker(page).click();
  await expect(page.getByRole('status').filter({ hasText: 'out of credits' })).toBeVisible();
  await expect(page.getByTestId('read-aloud-player')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { spoken: string[] }).spoken)).toEqual(['The build is green.', 'Two tests were added.']);
});

test('without a key on the machine, ElevenLabs is disabled and points at its page', async ({ page }) => {
  delete agent.dictationKeys.elevenlabs;
  await fakeVoice(page);
  await openDemo(page);
  await longPress(page);
  await expect(page.getByRole('option', { name: /ElevenLabs/ })).toBeDisabled();
  await expect(page.getByTestId('read-aloud-menu')).toContainText('No ElevenLabs key on this machine');
  await expect(page.getByTestId('read-aloud-menu')).toContainText('charges credits');
  await page.getByRole('button', { name: 'Add an ElevenLabs key' }).click();
  await expect(page.getByTestId('machine-key-elevenlabs')).toBeVisible();
});

test('picks the ElevenLabs voice in Settings, from the menu', async ({ page }) => {
  await fakeVoice(page);
  const requests = await fakeElevenLabs(page);
  await openDemo(page);
  await pickElevenLabs(page);
  await longPress(page);
  await page.getByRole('button', { name: 'Choose a voice…' }).click();
  const voices = page.getByTestId('elevenlabs-voices');
  await expect(voices).toBeInViewport();
  await voices.getByRole('button', { name: 'Show the voices' }).click();
  await expect(voices).toContainText('The voices of the ElevenLabs account on Test');
  await voices.getByRole('option', { name: /Ann/ }).click();
  await expect(voices.getByRole('option', { name: /Ann/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByText('demo', { exact: true }).click();
  await speaker(page).click();
  await expect(page.getByTestId('read-aloud-player').getByRole('button', { name: 'Pause' })).toBeVisible();
  expect(requests.at(-1)!.url).toContain('/v1/text-to-speech/ann-1');
});

test('with the bar scrolled so the speaker sits at the left edge, its menu stays on screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fakeVoice(page);
  await openDemo(page);
  await speaker(page).evaluate((el) => {
    const bar = el.closest('[role="toolbar"]')!;
    bar.scrollLeft += el.getBoundingClientRect().left - 4;
  });
  expect((await speaker(page).boundingBox())!.x).toBeLessThan(60);
  await longPress(page);
  const box = (await page.getByTestId('read-aloud-menu').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});
