import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import vm from 'node:vm';
import { sanitize, DeucalInt } from '../dist/sdk.js';
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
  const loaderSize = zlib.gzipSync(fs.readFileSync('dist/dashboard/ingest.js')).length;
  assert.ok(size < 12 * 1024, `SDK gzip size ${size}`);
  assert.ok(loaderSize < 12 * 1024, `Loader gzip size ${loaderSize}`);
  console.log(`SDK gzip bytes: ${size}`);
  console.log(`Loader gzip bytes: ${loaderSize}`);
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

function browserFixture() {
  const originals = new Map();
  const set = (key, value) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const storage = () => {
    const values = new Map();
    return {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    };
  };
  const bodies = [];
  const window = new EventTarget();
  window.fetch = async (_, options) => {
    bodies.push(JSON.parse(options.body));
    return { ok: true, status: 202 };
  };
  const document = new EventTarget();
  Object.assign(document, {
    referrer: 'https://example.org/source?email=person@example.com#private',
    documentElement: { scrollHeight: 1000 },
    querySelectorAll: () => [],
    visibilityState: 'visible',
  });
  const observers = [];
  class Observer {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe(options) {
      this.options = options;
    }
    disconnect() {
      this.disconnected = true;
    }
  }
  class XHR extends EventTarget {
    open() {}
    send() {}
  }
  class Element extends EventTarget {
    closest() {
      return null;
    }
  }
  set('window', window);
  set('document', document);
  set('location', new URL('https://shop.example/products?email=visitor@example.com#secret'));
  set('navigator', { doNotTrack: '0', onLine: true, userAgent: 'Chrome', sendBeacon: () => true });
  set('localStorage', storage());
  set('sessionStorage', storage());
  set('history', { pushState() {}, replaceState() {} });
  set('Element', Element);
  set('XMLHttpRequest', XHR);
  set('PerformanceObserver', Observer);
  set('innerWidth', 1200);
  set('innerHeight', 800);
  set('scrollY', 0);
  return {
    window,
    document,
    bodies,
    observers,
    cleanup() {
      window.deucalint?.destroy();
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test('browser capture waits for explicit consent and honors Do Not Track', async () => {
  const fixture = browserFixture();
  const originalFetch = fixture.window.fetch;
  const sdk = new DeucalInt();
  try {
    sdk.init({ projectToken: 'pk_test', endpoint: 'https://collector.example' });
    sdk.track('purchase');
    await sdk.flush();
    assert.equal(sdk.stats().queued, 0);
    assert.equal(localStorage.getItem('deucalint:pk_test'), null);
    assert.equal(fixture.window.fetch, originalFetch);
    assert.equal(fixture.bodies.length, 0);
    sdk.consent(true);
    assert.equal(sdk.stats().queued, 1);
    await sdk.flush();
    assert.equal(fixture.bodies[0].events[0].name, 'page_view');
    assert.equal(fixture.bodies[0].events[0].page.referrer, 'https://example.org/source');
    assert.equal(fixture.bodies[0].events[0].page.url, 'https://shop.example/products');
    sdk.consent(false);
    assert.equal(sdk.stats().consent, false);
    assert.equal(localStorage.getItem('deucalint:pk_test'), null);
    assert.equal(sessionStorage.getItem('deucalint:pk_test:queue'), null);
    assert.equal(fixture.window.fetch, originalFetch);
    // A suspended tab may retain its own queue until it resumes: a revoked identity
    // must never restore that queue after fresh consent creates a new identity.
    sessionStorage.setItem('deucalint:pk_test:queue', JSON.stringify(fixture.bodies[0].events));
    sdk.consent(true);
    assert.equal(sdk.stats().queued, 1);
    sdk.consent(false);
    navigator.doNotTrack = '1';
    sdk.consent(true);
    assert.equal(sdk.stats().consent, false);
  } finally {
    sdk.destroy();
    fixture.cleanup();
  }
});

test('reload preserves queued events and session; active shared sessions are reused and idle sessions expire', async () => {
  const fixture = browserFixture();
  const options = { projectToken: 'pk_test', endpoint: 'https://collector.example', consent: true };
  let sdk = new DeucalInt().init(options);
  const realNow = Date.now;
  try {
    sdk.track('purchase');
    const original = JSON.parse(localStorage.getItem('deucalint:pk_test'));
    sdk.destroy();
    sdk = new DeucalInt().init(options);
    await sdk.flush();
    assert.equal(fixture.bodies[0].events.length, 3);
    assert.ok(fixture.bodies[0].events.every((event) => event.sessionId === original.sessionId));
    assert.ok(
      fixture.bodies[0].events.every((event) => event.anonymousId === original.anonymousId),
    );
    // Another active tab has already refreshed the shared session.
    localStorage.setItem(
      'deucalint:pk_test',
      JSON.stringify({ ...original, sessionId: 'other-tab-session', lastActivity: realNow() }),
    );
    sdk.track('cross_tab_action');
    await sdk.flush();
    assert.equal(fixture.bodies[1].events[0].sessionId, 'other-tab-session');
    Date.now = () => realNow() + 31 * 60 * 1000;
    sdk.track('after_idle');
    await sdk.flush();
    assert.notEqual(fixture.bodies[2].events[0].sessionId, 'other-tab-session');
  } finally {
    Date.now = realNow;
    sdk.destroy();
    fixture.cleanup();
  }
});

test('resource timing is bounded, strips sensitive URL data, and stops on cross-tab consent revocation', async () => {
  const fixture = browserFixture();
  const sdk = new DeucalInt().init({
    projectToken: 'pk_test',
    endpoint: 'https://collector.example',
    consent: true,
    batchSize: 100,
  });
  try {
    const observer = fixture.observers.find((item) => item.options?.type === 'resource');
    assert.ok(observer);
    observer.callback({
      getEntries: () =>
        Array.from({ length: 70 }, () => ({
          name: 'https://cdn.example/assets/person@example.com?token=private#secret',
          initiatorType: 'img',
          duration: 1500,
          transferSize: 4000,
          encodedBodySize: 3900,
          decodedBodySize: 9000,
        })),
    });
    await sdk.flush();
    const resources = fixture.bodies[0].events.filter((event) => event.name === 'resource_timing');
    assert.equal(resources.length, 50);
    assert.equal(resources[0].properties.path, '/assets/[email]');
    assert.ok(!JSON.stringify(resources).includes('private'));
    fixture.window.dispatchEvent(
      Object.assign(new Event('storage'), { key: 'deucalint:pk_test', newValue: null }),
    );
    assert.equal(sdk.stats().consent, false);
    assert.equal(observer.disconnected, true);
    observer.callback({
      getEntries: () => [{ name: 'https://example.com/late', initiatorType: 'img' }],
    });
    assert.equal(sdk.stats().queued, 0);
  } finally {
    sdk.destroy();
    fixture.cleanup();
  }
});

test('one-script loader exposes an opt-in API, avoids duplicate embeds, and rejects unsafe endpoints', async () => {
  const fixture = browserFixture();
  const source = fs.readFileSync('dist/dashboard/ingest.js', 'utf8');
  const attributes = { 'data-token': 'pk_embed', 'data-endpoint': 'https://collector.example' };
  fixture.document.currentScript = {
    src: 'https://collector.example/ingest.js',
    getAttribute: (name) => attributes[name] ?? null,
  };
  try {
    vm.runInThisContext(source);
    const api = fixture.window.deucalint;
    assert.ok(api);
    assert.equal(api.stats().consent, false);
    api.consent(true);
    vm.runInThisContext(source);
    assert.equal(fixture.window.deucalint, api);
    assert.equal(api.stats().queued, 1);
    await api.flush();
    assert.equal(fixture.bodies[0].projectToken, 'pk_embed');
    api.destroy();
    attributes['data-endpoint'] = 'javascript:alert(1)';
    vm.runInThisContext(source);
    assert.equal(fixture.window.deucalint, undefined);
  } finally {
    fixture.cleanup();
  }
});
