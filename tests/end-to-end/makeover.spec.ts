import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  const overview = page.waitForResponse((response) => response.url().includes('/api/insights'));
  await page.getByRole('button', { name: 'Enter workspace' }).click();
  expect((await overview).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveCSS('position', 'fixed');
  await expect(page.locator('.sidebar')).toHaveCSS('width', '218px');
  await expect.poll(() => page.locator('di-geography svg path').count()).toBeGreaterThan(100);
});

test('one-script onboarding makes consent explicit and verifies a real collection asset', async ({
  page,
  request,
}, testInfo) => {
  const status = page.waitForResponse((response) => response.url().includes('/api/setup?'));
  await page.getByRole('button', { name: 'Connect your site', exact: true }).click();
  expect((await status).status()).toBe(200);
  await page.getByRole('button', { name: /A single snippet/ }).click();
  await expect(page.getByRole('heading', { name: 'Add once. Understand more.' })).toBeVisible();
  const snippet = page.locator('.code-window pre');
  await expect(snippet).toContainText('/ingest.js');
  await expect(snippet).toContainText('data-token="pk_demo_deucalint"');
  await expect(snippet).not.toContainText('data-consent');
  await expect(page.getByText('window.deucalint.consent(true)', { exact: true })).toBeVisible();
  await page.getByLabel('My site has already received analytics consent.').check();
  await expect(snippet).toContainText('data-consent="granted"');
  await page.getByLabel('My site has already received analytics consent.').uncheck();
  await expect(snippet).not.toContainText('data-consent');
  await page.getByRole('button', { name: 'Tag manager', exact: true }).click();
  await expect(page.getByText(/Create a Custom HTML tag/)).toBeVisible();
  const asset = await request.get('/ingest.js');
  expect(asset.status()).toBe(200);
  expect(asset.headers()['content-type']).toMatch(/javascript/);
  expect(await asset.text()).toContain('deucalint:ready');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('onboarding.png'), fullPage: true });
});

test('event discovery searches real names and creates a funnel without redefining an event', async ({
  page,
}) => {
  await page.getByRole('link', { name: 'Auto-captured events' }).click();
  await expect(page.getByRole('heading', { name: 'Your event library' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search captured events' }).fill('purchase_completed');
  const purchase = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'purchase_completed', exact: true }) });
  await expect(purchase).toHaveCount(1);
  const funnel = page.waitForResponse((response) => response.url().includes('/api/funnels?'));
  await purchase.getByRole('button', { name: 'Build funnel' }).click();
  expect((await funnel).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Purchase journey', exact: true })).toBeVisible();
  await expect(page.getByLabel('Funnel step').nth(0)).toHaveValue('page_view');
  await expect(page.getByLabel('Funnel step').nth(1)).toHaveValue('purchase_completed');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('journey diagram supports keyboard selection and a readable data table', async ({
  page,
}, testInfo) => {
  const response = page.waitForResponse((item) => item.url().includes('/api/journey-graph?'));
  await page.getByRole('link', { name: 'Journeys', exact: true }).click();
  expect((await response).status()).toBe(200);
  const graph = page.locator('di-journey-flow');
  const node = graph.getByRole('button', { name: /Select to highlight links/ }).first();
  await expect(node).toBeVisible();
  await node.focus();
  await page.keyboard.press('Enter');
  await expect(graph.getByRole('button', { name: 'Reset focus' })).toBeEnabled();
  await expect(graph.locator('.flow-detail')).toContainText('sessions');
  await graph.getByText('View accessible journey data', { exact: true }).click();
  await expect(graph.getByRole('columnheader', { name: 'From', exact: true })).toBeVisible();
  await expect(graph.getByRole('columnheader', { name: 'Sessions', exact: true })).toBeVisible();
  await graph.getByRole('button', { name: 'Clear selection' }).click();
  await expect(graph.getByRole('button', { name: 'Reset focus' })).toBeDisabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('journey-keyboard.png'), fullPage: true });
});

test('country selection applies its segment to the server query', async ({ page }) => {
  const geography = page.locator('di-geography');
  const country = geography
    .getByRole('button', { name: /^Filter country/ })
    .filter({ has: page.locator('.country-code') })
    .first();
  await expect(country).toBeEnabled();
  const countryCode = (await country.locator('.country-code').textContent())!.trim();
  const response = page.waitForResponse(
    (item) =>
      item.url().includes('/api/overview?') && new URL(item.url()).searchParams.has('segment'),
  );
  await country.focus();
  await page.keyboard.press('Enter');
  const filtered = await response;
  expect(filtered.status()).toBe(200);
  const segment = JSON.parse(new URL(filtered.url()).searchParams.get('segment')!);
  expect(segment.and).toContainEqual({ dimension: 'country', operator: 'eq', value: countryCode });
  await expect(
    page.getByRole('button', { name: `country eq ${countryCode} ×`, exact: true }),
  ).toBeVisible();
});

test('command dialog traps keyboard focus and returns it to its trigger', async ({ page }) => {
  await page.getByRole('link', { name: 'Skip to content', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main-content')).toBeFocused();
  const trigger = page.getByRole('button', { name: /Search workspace/ });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Search workspace' });
  const search = dialog.getByRole('textbox', { name: 'Search pages' });
  await expect(search).toBeFocused();
  await search.fill('Auto-captured');
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Close · Esc' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(search).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('setup and journey views fit a narrow screen with reduced motion', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const destination of ['Connect a source', 'Auto-captured events', 'Journeys']) {
    await page.getByRole('link', { name: destination, exact: true }).click();
    await expect(page.getByRole('heading', { name: destination, exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`${destination.replaceAll(' ', '-')}-mobile.png`),
      fullPage: true,
    });
  }
});

test('rolling retention exposes denominators and journey anchors query the server', async ({
  page,
}) => {
  await page.getByRole('link', { name: 'Retention', exact: true }).click();
  const rolling = page.waitForResponse(
    (r) => r.url().includes('/api/retention?') && r.url().includes('mode=rolling'),
  );
  await page.getByRole('button', { name: 'On or after', exact: true }).click();
  expect((await rolling).status()).toBe(200);
  await page.locator('.retention-cell').first().click();
  await expect(page.locator('.cohort-detail')).toContainText('eligible visitors');
  await page.getByRole('link', { name: 'Journeys', exact: true }).click();
  await page.getByLabel('Journey anchor').fill('purchase_completed');
  await page.getByLabel('Journey anchor').press('Tab');
  const backwards = page.waitForResponse(
    (r) => r.url().includes('/api/journey-graph?') && r.url().includes('direction=backward'),
  );
  await page.getByLabel('Journey direction').selectOption('backward');
  const response = await backwards;
  expect(response.status()).toBe(200);
  const graph = await response.json();
  expect(graph.anchor).toBe('purchase_completed');
  expect(graph.direction).toBe('backward');
  expect(graph.nodes.length).toBeGreaterThan(0);
});

