import { test, expect } from '@playwright/test';

// The legal pages are static files beside the app. The Worker's SPA fallback and the service
// worker's navigation fallback both answer an unknown path with the app shell, so each check reads
// the page's own text, and the second visit runs under the service worker the first one installed.

test('the first-run screen links to the terms, which link back to the app', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('legal-accept')).toBeVisible();

  await page.getByRole('link', { name: 'Terms of use' }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Terms of use' })).toBeVisible();

  await page.getByRole('link', { name: '‹ Back to Tarfa' }).click();
  await expect(page.getByTestId('home-add-machine')).toBeVisible();
});

test('both pages are served under the service worker, and Settings links to them', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  for (const [path, heading] of [
    ['/privacy', 'Privacy notice'],
    ['/terms', 'Terms of use'],
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    expect(await page.locator('script').count()).toBe(0);
  }

  await page.goto('/');
  await page.getByRole('button', { name: /add a machine/i }).click();
  const links = page.getByTestId('legal-links');
  await expect(links.getByRole('link', { name: 'Privacy notice' })).toHaveAttribute('href', '/privacy');
  await expect(links.getByRole('link', { name: 'Source code' })).toHaveAttribute('href', 'https://github.com/abumalick/tarfa');
});
