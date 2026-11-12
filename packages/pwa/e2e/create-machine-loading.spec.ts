import { test, expect } from '@playwright/test';
import { machineEntry, startFakeAgent } from './fake-agent';

// The create form lists every enabled machine in the Settings order, a machine that has not
// connected as a disabled pill, so the user can create on one that is up while another is not.
test('creates on the connected machine while the last-used one cannot connect', async ({ page }) => {
  const up = await startFakeAgent();
  const down = await startFakeAgent();
  try {
    const machines = [
      await machineEntry(down, { id: 'down', name: 'Laptop' }),
      await machineEntry(up, { id: 'up', name: 'Server' }),
    ];
    await down.close();
    await page.addInitScript((m) => {
      localStorage.setItem('tarfa.machines', JSON.stringify(m));
      localStorage.setItem('tarfa.lastMachine', 'down');
    }, machines);
    await page.goto('/');
    await page.getByRole('button', { name: /^new$/i }).click();
    await expect(page.getByRole('heading', { name: /new workspace/i })).toBeVisible();

    const radios = page.getByRole('radio', { name: /Laptop|Server/ });
    await expect(radios).toHaveCount(2);
    expect(await radios.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual(['down', 'up']);
    await expect(page.getByRole('radio', { name: /Laptop/ })).toBeDisabled();
    await expect(page.getByRole('radio', { name: 'Server' })).toBeChecked();

    await page.getByTestId('path').fill('/home/u/workspace/demo');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect.poll(() => up.created.at(-1)?.projectPath).toBe('/home/u/workspace/demo');
  } finally {
    await up.close();
  }
});

test('shows a loader instead of the form while no machine is connected', async ({ page }) => {
  const down = await startFakeAgent();
  const entry = await machineEntry(down, { id: 'down', name: 'Laptop' });
  await down.close();
  await page.addInitScript((m) => localStorage.setItem('tarfa.machines', JSON.stringify([m])), entry);
  await page.goto('/');
  await page.getByRole('button', { name: /^new$/i }).click();
  await expect(page.getByTestId('create-waiting')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Laptop/ })).toBeDisabled();
  await expect(page.getByTestId('path')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toHaveCount(0);
});
