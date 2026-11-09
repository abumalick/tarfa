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
async function fakeVoice(page: Page) {
  await page.addInitScript(() => {
    type U = { text: string; onstart?: () => void; onend?: () => void };
    const queue: U[] = [];
    const spoken: string[] = [];
    (window as unknown as { spoken: string[] }).spoken = spoken;
    class Utterance {
      lang = '';
      volume = 1;
      onstart?: () => void;
      onend?: () => void;
      onerror?: () => void;
      constructor(public text: string) {}
    }
    const startHead = () => queue[0]?.onstart?.();
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utterance });
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        speak(u: U) {
          if (u.text.trim() === '') return;
          spoken.push(u.text);
          queue.push(u);
          if (queue.length === 1) startHead();
        },
        cancel() {
          queue.splice(0).forEach((u) => u.onend?.());
        },
      },
    });
  });
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
