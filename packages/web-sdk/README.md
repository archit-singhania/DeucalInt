# DeucalInt browser capture

Build with `npm run sdk:build` (also included in `npm run build`). Serve the generated `dist/dashboard/ingest.js` from your DeucalInt origin. The script is public; a project collection token permits event ingestion and never dashboard access. Register the website origin in the project's connection settings before installing.

```html
<script defer
  src="https://analytics.example.com/ingest.js"
  data-token="YOUR_PROJECT_COLLECTION_TOKEN"
  data-endpoint="https://analytics.example.com"></script>
```

The default is **no capture, storage, or event delivery until consent is granted**. Connect your existing consent banner's analytics approval to:

```js
window.deucalint.consent(true);
```

The `deucalint:ready` window event indicates that the API is available. When a site has already obtained analytics consent, it can render `data-consent="granted"` on the script. Consent is deliberately not persisted by the SDK: your consent manager must supply the current choice on each page. Browser Do Not Track overrides consent. To revoke, call `window.deucalint.consent(false)`; active tabs stop collection, installed hooks are removed, and stored identity and queued events are cleared.

Page views, SPA navigation, clicks, form submissions, scroll milestones, errors, network timing, Web Vitals, and resource metadata are captured automatically. Input values, DOM text, response bodies, and query strings are not collected. Mark private subtrees `data-analytics-ignore` or `data-analytics-mask`. Named clicks can use an optional attribute without writing event handlers:

```html
<button data-deucalint-event="checkout_started">Checkout</button>
```

Explicit APIs are available for business events, which cannot be reliably inferred from generic clicks:

```js
window.deucalint.track('purchase_completed', { amount: 49, currency: 'USD' });
window.deucalint.identify('pseudonymous-customer-id');
window.deucalint.reset(); // Clear identity and begin a new session.
```

Identity and a 30-minute inactivity session are shared across same-origin tabs. Each tab keeps its own queue in session storage to avoid one tab overwriting another tab's unacknowledged events. Queues survive reload, are bounded to 500 events, and are removed when the tab is closed. Offline delivery uses retry/backoff and stable event IDs; collection deduplicates acknowledged retries. Web resources are limited to 50 records per initialization. Optional `data-replay="true"` captures masked element geometry; this is a schematic playback, not complete DOM replay.

The script needs permission under your site's `script-src` and `connect-src` content security policies. The collector must allow the exact website origin. Custom business events and consent integration require a small site change; this is a one-script installation, not a claim of zero setup.

Run `npm test` for SDK unit tests and `npm run test:sdk:browser` for the real Chromium cross-origin, consent, privacy, session, and revocation check.
