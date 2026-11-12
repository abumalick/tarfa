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

// A microphone that records nothing, so the mic can start without a device or a prompt.
async function fakeMicrophone(page: Page) {
  await page.addInitScript(() => {
    const track = { stop() {} };
    const stream = { getTracks: () => [track] };
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => stream }, configurable: true });
    class FakeRecorder {
      mimeType = 'audio/webm';
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {}
      stop() {
        this.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) });
        this.onstop?.();
      }
    }
    (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  });
}

test('Cancel above the recording mic throws the recording away and sends nothing', async ({ page }) => {
  await fakeMicrophone(page);
  const transcriptions: string[] = [];
  await page.route('https://api.elevenlabs.io/**', (route) => {
    transcriptions.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'should not be typed' }) });
  });
  await seedMachine(page, agent);
  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'TARFA_READY' })).toBeVisible();

  const bar = page.getByRole('toolbar', { name: 'Terminal keys' });
  const mic = bar.getByRole('button', { name: /^Dictate/ });
  await mic.click();
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  const cancel = page.getByRole('button', { name: 'Cancel dictation: nothing is sent' });
  await expect(cancel).toBeVisible();
  await expect(page.getByRole('timer')).toHaveText(/0:0\d/);

  // Above the mic, clear of the bar, and inside the screen.
  const pill = await cancel.boundingBox();
  const micBox = await mic.boundingBox();
  expect(pill!.y + pill!.height).toBeLessThanOrEqual(micBox!.y);
  expect(pill!.x).toBeGreaterThanOrEqual(0);
  expect(pill!.x + pill!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath('recording.png') });

  await cancel.click();
  await expect(cancel).toHaveCount(0);
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(300);
  expect(transcriptions).toEqual([]);
});
