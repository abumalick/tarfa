import type { Locator, Page } from '@playwright/test';

// Drags a grip by `dy` px with a real pointer, in steps, as a finger would.
export async function dragBy(page: Page, grip: Locator, dy: number) {
  const box = (await grip.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x, y + (dy * i) / 8);
  await page.mouse.up();
}
