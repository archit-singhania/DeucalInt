import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium, firefox, webkit } from '@playwright/test';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const close = (server) => new Promise((resolve) => server.close(resolve));
const browserName = process.env.SDK_BROWSER || 'chromium';
const engine = { chromium, firefox, webkit }[browserName];
if (!engine) throw new Error('SDK_BROWSER must be chromium, firefox, or webkit');

test(`${browserName}: cross-origin embed waits for consent, autocaptures, survives reload, and revokes across tabs`, async () => {
  const batches = [];
  let websiteOrigin = '';
  const collector = createServer(async (req, res) => {
    if (req.headers.origin === websiteOrigin) {
      res.setHeader('Access-Control-Allow-Origin', websiteOrigin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type',
      });
      return res.end();
    }
    if (req.url === '/ingest.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      return res.end(readFileSync('dist/dashboard/ingest.js'));
    }
    if (req.url === '/v1/batch' && req.method === 'POST') {
      let data = '';
      for await (const chunk of req) data += chunk;
      batches.push(JSON.parse(data));
      res.writeHead(202, { 'Content-Type': 'application/json' });
      return res.end('{"accepted":true}');
    }
    res.writeHead(404);
    res.end();
  });
  await listen(collector);
  const collectorOrigin = `http://127.0.0.1:${collector.address().port}`;
  const website = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><html><head><title>SDK fixture</title>
      <script defer src="${collectorOrigin}/ingest.js" data-token="pk_browser_test" data-endpoint="${collectorOrigin}"></script>
      </head><body><h1>Test store</h1><button data-deucalint-event="purchase_started">Buy</button>
      <input value="sensitive-customer-value" data-analytics-mask><button data-analytics-ignore>Private</button></body></html>`);
  });
  await listen(website);
  websiteOrigin = `http://127.0.0.1:${website.address().port}`;
  let browser;
  try {
    browser = await engine.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${websiteOrigin}/?token=private-query`);
    await page.waitForFunction(() => !!window.deucalint);
    assert.equal(await page.evaluate(() => window.deucalint.stats().consent), false);
    await page.evaluate(() => window.deucalint.flush());
    assert.equal(batches.length, 0);
    await page.evaluate(() => window.deucalint.consent(true));
    await page.getByRole('button', { name: 'Buy', exact: true }).click();
    await page.getByRole('button', { name: 'Private', exact: true }).click();
    await page.evaluate(() => window.deucalint.flush());
    const initial = batches.flatMap((batch) => batch.events);
    assert.ok(initial.some((event) => event.name === 'page_view'));
    assert.ok(initial.some((event) => event.name === 'purchase_started'));
    assert.equal(initial.filter((event) => event.name === 'click').length, 0);
    assert.ok(!JSON.stringify(batches).includes('private-query'));
    assert.ok(!JSON.stringify(batches).includes('sensitive-customer-value'));
    const firstPage = initial.find((event) => event.name === 'page_view');
    await page.goto(`${websiteOrigin}/next`);
    await page.waitForFunction(() => !!window.deucalint);
    // Consent belongs to the site's banner: it is never silently persisted by this SDK.
    assert.equal(await page.evaluate(() => window.deucalint.stats().consent), false);
    await page.evaluate(async () => {
      window.deucalint.consent(true);
      await window.deucalint.flush();
    });
    const nextPage = batches
      .flatMap((batch) => batch.events)
      .find((event) => event.page.path === '/next');
    assert.equal(nextPage.sessionId, firstPage.sessionId);
    assert.equal(nextPage.anonymousId, firstPage.anonymousId);
    const second = await context.newPage();
    await second.goto(websiteOrigin);
    await second.waitForFunction(() => !!window.deucalint);
    await second.evaluate(() => window.deucalint.consent(true));
    await page.evaluate(() => window.deucalint.consent(false));
    await second.waitForFunction(() => !window.deucalint.stats().consent);
    assert.equal(await second.evaluate(() => window.deucalint.stats().queued), 0);
    await context.close();
  } finally {
    await browser?.close();
    await Promise.all([close(website), close(collector)]);
  }
});
