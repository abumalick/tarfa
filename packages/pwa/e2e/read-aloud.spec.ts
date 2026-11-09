import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_WORKSPACES, seedMachine, startFakeAgent, type FakeAgent } from './fake-agent';

let agent: FakeAgent;

test.beforeAll(async () => {
  // The key is offered only in a workspace that runs Claude.
  agent = await startFakeAgent(DEFAULT_WORKSPACES.map((w) => ({ ...w, command: 'claude' })));
  agent.lastReplies['perch-demo'] = 'The build is green. Two tests were added.';
});
test.afterAll(async () => {
  await agent.close();
});

// A stand-in for the phone's voice: records what it is asked to say, and starts each utterance
// at once and finishes it only when the spec says so.
// `silent`: a voice that takes every utterance and never starts one (no engine for it).
async function fakeVoice(page: Page, silent = false) {
  await page.addInitScript((silent) => {
    type U = { text: string; rate: number; onstart?: () => void; onend?: () => void };
    const queue: U[] = [];
    const spoken: string[] = [];
    const rates: number[] = [];
    (window as unknown as { spoken: string[]; rates: number[] }).spoken = spoken;
    (window as unknown as { rates: number[] }).rates = rates;
    class Utterance {
      lang = '';
      rate = 1;
      volume = 1;
      onstart?: () => void;
      onend?: () => void;
      onerror?: () => void;
      constructor(public text: string) {}
    }
    const startHead = () => (silent ? undefined : queue[0]?.onstart?.());
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utterance });
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        paused: false,
        get speaking() {
          return queue.length > 0;
        },
        get pending() {
          return queue.length > 1;
        },
        getVoices: () => [],
        resume() {},
        speak(u: U) {
          if (u.text.trim() === '') return;
          spoken.push(u.text);
          rates.push(u.rate);
          queue.push(u);
          if (queue.length === 1) startHead();
        },
        cancel() {
          queue.splice(0).forEach((u) => u.onend?.());
        },
      },
    });
  }, silent);
}

async function openDemo(page: Page) {
  await seedMachine(page, agent);
  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'TARFA_READY' })).toBeVisible();
}

const listen = (page: Page) => page.getByRole('toolbar', { name: 'Terminal keys' }).getByRole('button', { name: 'Listen to the last reply' });

test('reads the last reply aloud with player controls', async ({ page }) => {
  await fakeVoice(page);
  await openDemo(page);
  await listen(page).click();
  const player = page.getByTestId('read-aloud-player');
  await expect(player).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { spoken: string[] }).spoken)).toEqual([
    'The build is green.',
    'Two tests were added.',
  ]);
  await player.getByRole('button', { name: 'Pause' }).click();
  await expect(player.getByRole('button', { name: 'Play' })).toBeVisible();
  await player.getByRole('button', { name: 'Stop and close' }).click();
  await expect(player).toHaveCount(0);
});

test('says when there is no reply to read', async ({ page }) => {
  await fakeVoice(page);
  await seedMachine(page, agent);
  await page.goto('/');
  await page.getByText('other', { exact: true }).click();
  await listen(page).click();
  await expect(page.getByRole('status').filter({ hasText: 'No reply to read yet' })).toBeVisible();
});

test('offers no listen key where the browser has no voice', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
    Object.defineProperty(window, 'speechSynthesis', { value: undefined });
  });
  await openDemo(page);
  await expect(page.getByRole('toolbar', { name: 'Terminal keys' }).getByRole('button', { name: 'Cursor pad' })).toBeVisible();
  await expect(listen(page)).toHaveCount(0);
});

test('the player fits a 320 px screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await fakeVoice(page);
  await openDemo(page);
  await listen(page).click();
  const player = await page.getByTestId('read-aloud-player').boundingBox();
  const close = await page.getByTestId('read-aloud-player').getByRole('button', { name: 'Stop and close' }).boundingBox();
  expect(close!.x + close!.width).toBeLessThanOrEqual(player!.x + player!.width);
  expect(player!.x + player!.width).toBeLessThanOrEqual(320);
});

test('reads at the speed picked in the player, and keeps it', async ({ page }) => {
  await fakeVoice(page);
  await openDemo(page);
  await listen(page).click();
  const player = page.getByTestId('read-aloud-player');
  await player.getByRole('button', { name: 'Speed 1×' }).click();
  await player.getByRole('group', { name: 'Reading speed' }).getByRole('button', { name: '1.5×' }).click();
  await expect(player.getByRole('button', { name: 'Speed 1.5×' })).toBeVisible();
  // The sentence restarts at the new speed once the adapter's pause after a cancel is over.
  await expect.poll(() => page.evaluate(() => (window as unknown as { rates: number[] }).rates.at(-1))).toBe(1.5);
  expect(await page.evaluate(() => localStorage.getItem('tarfa.readAloudRate'))).toBe('1.5');
});

test('a silent voice closes the player and offers this device\'s help', async ({ page }) => {
  await page.clock.install();
  await fakeVoice(page, true);
  await openDemo(page);
  await listen(page).click();
  await expect(page.getByTestId('read-aloud-player')).toBeVisible();
  await page.clock.fastForward(13_000);
  const notice = page.getByRole('status').filter({ hasText: 'did not start' });
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'How to fix' }).click();
  const help = page.getByRole('dialog', { name: 'Turning on the phone’s voice' });
  await expect(help).toBeVisible();
  await expect(help.getByRole('button', { name: 'Done' })).toBeFocused();
  await help.getByRole('button', { name: 'Done' }).click();
  await expect(help).toHaveCount(0);
});

test('the clock moves every second while a sentence is read', async ({ page }) => {
  const reply = agent.lastReplies['perch-demo']!;
  agent.lastReplies['perch-demo'] = 'This one sentence is long enough to be read for several seconds by the voice.';
  try {
    await page.clock.install();
    await fakeVoice(page);
    await openDemo(page);
    await listen(page).click();
    const time = page.getByTestId('read-aloud-player').locator('.time');
    await expect(time).toHaveText(/^0:00 \//);
    await page.clock.fastForward(3000);
    await expect(time).toHaveText(/^0:03 \//);
  } finally {
    agent.lastReplies['perch-demo'] = reply;
  }
});
