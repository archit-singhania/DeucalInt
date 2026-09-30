import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
});
test('overview, segments, investigation, and evidence', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(page.getByText('Traffic & engagement')).toBeVisible();
  await page.screenshot({ path: 'test-results/overview-desktop.png', fullPage: true });
  await page.getByLabel('Browser segment').selectOption('Safari');
  await expect(page.getByText('Traffic & engagement')).toBeVisible();
  await page.getByRole('button', { name: 'Investigate changes' }).click();
  await expect(page.getByText('Investigation findings')).toBeVisible();
  await page.getByRole('button').filter({ hasText: 'Conversion comparison' }).click();
  await expect(page.getByRole('dialog', { name: 'Query evidence' })).toBeVisible();
  await page.getByLabel('Close evidence').click();
  await page.screenshot({ path: 'test-results/investigation-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('all analytic pages load real API data', async ({ page }) => {
  for (const [link, heading] of [
    ['Funnels', 'Purchase journey'],
    ['Retention', 'Cohort retention'],
    ['Journeys', 'Paths through your product'],
    ['Experiments', 'Pricing redesign'],
    ['Sessions & replay', 'Session explorer'],
    ['Errors & performance', 'Error groups'],
    ['Alerts', 'Your early warning system'],
    ['Project settings', 'Privacy & retention'],
  ]) {
    await page.getByRole('link', { name: link, exact: false }).first().click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
});
test('consented demo events enter the live stream', async ({ page }) => {
  await page.getByLabel('Project', { exact: true }).selectOption('sandbox');
  await page.getByRole('link', { name: 'Demo commerce' }).click();
  await page.getByRole('button', { name: 'Enable tracking' }).click();
  await page.getByRole('button', { name: 'Add to bag' }).click();
  await page.getByRole('button', { name: 'Complete checkout' }).click();
  await expect(page.getByText('Order placed. Thank you')).toBeVisible();
  await page.getByRole('link', { name: 'Live activity' }).click();
  await expect(
    page.getByRole('cell', { name: 'purchase_completed', exact: true }).first(),
  ).toBeVisible({ timeout: 15000 });
});
test('mobile layout and navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText('Traffic & engagement')).toBeVisible();
  await page.screenshot({ path: 'test-results/overview-mobile.png', fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
});
