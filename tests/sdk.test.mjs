import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { sanitize } from '../dist/sdk.js';
import { DeucalIntNode } from '../packages/node-sdk/index.mjs';
test('privacy recursively removes credentials and sensitive strings', () => {
  const out = sanitize({
    password: 'abc',
    nested: { email: 'a@b.com' },
    description: 'Contact me at person@example.com',
    card: '4111111111111111',
  });
  assert.equal(out.password, '[redacted]');
  assert.equal(out.nested.email, '[redacted]');
  assert.ok(!JSON.stringify(out).includes('person@example'));
});
test('web SDK compressed bundle stays below 12 KiB', () => {
  const size = zlib.gzipSync(fs.readFileSync('dist/sdk.js')).length;
  assert.ok(size < 12 * 1024, `SDK gzip size ${size}`);
  console.log(`SDK gzip bytes: ${size}`);
});
test('node SDK preserves IDs across delivery retry and drains acknowledged batches', async () => {
  const original = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_, opts) => {
    bodies.push(JSON.parse(opts.body));
    if (bodies.length === 1) throw new Error('offline');
    return { ok: true, status: 202 };
  };
  try {
    const sdk = new DeucalIntNode({ projectToken: 'pk_test', endpoint: 'http://test' });
    sdk.track('purchase', { amount: 49 });
    await sdk.flush();
    assert.equal(sdk.queue.length, 0);
    assert.equal(bodies[0].events[0].eventId, bodies[1].events[0].eventId);
  } finally {
    globalThis.fetch = original;
  }
});
