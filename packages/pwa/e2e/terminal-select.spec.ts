import { test, expect } from '@playwright/test';
import { seedMachine, startFakeAgent, type FakeAgent } from './fake-agent';

let agent: FakeAgent;

test.beforeAll(async () => {
  agent = await startFakeAgent();
});
test.afterAll(async () => {
  await agent.close();
});

// Select mode covers the terminal with a plain-text snapshot that the browser's own selection
// works on. jsdom has no layout or selection, so whether a drag really selects the snapshot's
// text (and not xterm's unselectable rows beneath) is asserted here.
test('select mode shows a natively selectable snapshot of the terminal', async ({ page }) => {
  await seedMachine(page, agent);
  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'TARFA_READY' })).toBeVisible();

  const toggle = page.getByRole('button', { name: /select text/i });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const line = page.locator('.snapshot .line').filter({ hasText: 'TARFA_READY' });
  await expect(line).toBeVisible();

  const box = (await line.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 1, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, y, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('TARFA_READY');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.snapshot')).toHaveCount(0);
});

// The snapshot covers the terminal, so it must look like it: each cell's colour, and every
// row where xterm drew it. Claude Code wraps its own paragraphs at the terminal width; the
// snapshot draws them row by row while a selection across the break still reads one line.
test('select mode keeps the terminal colours and puts each row where the terminal drew it', async ({ page }) => {
  await seedMachine(page, agent);
  await page.goto('/');
  await page.getByText('demo', { exact: true }).click();
  await expect(page.locator('.xterm-rows').filter({ hasText: 'TARFA_READY' })).toBeVisible();

  // Scrollback, so the snapshot has to scroll to the viewport, and a glyph from outside ASCII,
  // which xterm stretches to its cell.
  agent.sendOutput('perch-demo', Array.from({ length: 80 }, (_, i) => `scroll${i}`).join('\r\n') + '\r\n');
  agent.sendOutput('perch-demo', '\u23bf AFTER_GLYPH\r\n\x1b[31mRED_WORD\x1b[0m plain\r\n');
  await expect(page.locator('.xterm-rows span').filter({ hasText: 'RED_WORD' })).toBeVisible();
  const cols = await page.evaluate(() => {
    const span = [...document.querySelectorAll<HTMLElement>('.xterm-rows span')].find((s) => s.textContent === 'RED_WORD')!;
    const cell = span.getBoundingClientRect().width / 'RED_WORD'.length;
    return Math.round(document.querySelector('.xterm-screen')!.getBoundingClientRect().width / cell);
  });
  const words = Array.from({ length: 40 }, (_, i) => `word${i}`);
  const rows: string[] = [];
  let row = ' ';
  for (const w of words) {
    if ((row + ' ' + w).length > cols) {
      rows.push(row);
      row = ' ';
    }
    row += ' ' + w;
  }
  rows.push(row);
  agent.sendOutput('perch-demo', rows.join('\r\n') + '\r\n');
  await expect(page.locator('.xterm-rows').filter({ hasText: 'word39' })).toBeVisible();

  // xterm redraws its rows (the cursor blinks), so each box is read in one synchronous step.
  const boxOf = (sel: string, text: string) =>
    page.evaluate(([sel, text]) => {
      const el = [...document.querySelectorAll<HTMLElement>(sel)].findLast((e) => e.textContent?.endsWith(text));
      const r = el?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, width: r.width } : null;
    }, [sel, text] as const);
  const before = await boxOf('.xterm-rows span', 'RED_WORD');
  const lastBefore = await boxOf('.xterm-rows > div', 'word39');
  const glyphEnd = async (sel: string) => {
    const box = (await boxOf(sel, 'AFTER_GLYPH'))!;
    return box.x + box.width;
  };
  const glyphBefore = await glyphEnd('.xterm-rows span');

  await page.getByRole('button', { name: /select text/i }).click();
  const snapRed = page.locator('.snapshot span').filter({ hasText: /^RED_WORD$/ });
  await expect(snapRed).toBeVisible();
  expect(await snapRed.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(204, 0, 0)');

  const after = (await snapRed.boundingBox())!;
  expect(Math.abs(after.x - before!.x)).toBeLessThan(1.5);
  expect(Math.abs(after.y - before!.y)).toBeLessThan(1.5);
  const lastRow = page.locator('.snapshot .row > span').filter({ hasText: 'word39' });
  const lastAfter = (await lastRow.boundingBox())!;
  expect(Math.abs(lastAfter.y - lastBefore!.y)).toBeLessThan(1.5);
  expect(Math.abs((await glyphEnd('.snapshot .row > span')) - glyphBefore)).toBeLessThan(1.5);

  const selected = await page.evaluate(() => {
    const line = [...document.querySelectorAll('.snapshot .line')].find((l) => l.textContent?.includes('word39'))!;
    const range = document.createRange();
    range.selectNodeContents(line);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    return getSelection()!.toString();
  });
  expect(selected.trimEnd()).toBe(`  ${words.join(' ')}`);
});
