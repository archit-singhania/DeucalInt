# SDK usage

## Browser

Import `DeucalInt` or the `analytics` singleton from `packages/web-sdk/src/index.ts` in a TypeScript app. `npm run sdk:build` creates an ESM bundle at `dist/sdk.js`.

```ts
import { analytics } from './deucalint-sdk';
analytics.init({
  projectToken: 'pk_demo_deucalint',
  endpoint: 'http://127.0.0.1:8100',
  consent: true, // set only after your application obtains consent
  respectDNT: true,
  replay: false,
  release: 'web-1.0.0'
});
analytics.track('checkout_started', { amount: 49, currency: 'USD' });
analytics.identify('pseudonymous-user-id');
analytics.experiment('pricing_redesign', 'B');
await analytics.flush();
analytics.consent(false); // stops capture and clears this project's queue
```

Default batching is 20 events or five seconds. Queue capacity is 500; oldest entries are dropped when full. Retries use exponential backoff with jitter. Beacon sends keep queued copies until a future acknowledged request; the collector deduplicates by event ID. Events must retain their original identity and timestamp on retries.

`data-analytics-ignore` prevents click/form/replay capture under an element. `data-analytics-mask` suppresses click/form capture. Replay always masks text and values, including elements without a mask attribute. No raw HTML is captured. `destroy()` restores patched browser APIs and stops observers. `stats()` reports queued/dropped events and consent status.

Limitations: identify emits an event but does not stitch histories; session state is not coordinated across tabs; compression is not implemented; performance observers are basic observations rather than a complete official Web Vitals implementation. Custom properties must not contain personal or credential data. Server scrubbing is defense in depth, not permission to send secrets.

## Node

```js
import { DeucalIntNode } from './packages/node-sdk/index.mjs';
const client = new DeucalIntNode({
  endpoint: 'http://127.0.0.1:8100', projectToken: 'pk_demo_deucalint'
});
client.track('purchase_completed', { amount: 49 }, 'visitor-123');
await client.flush();
```

The Node SDK batches up to 100 events and retries transient failures. Its queue is in memory; the application must call flush and handle final failures.

## Java

Build with `mvn -pl packages/java-sdk package`. The artifact is `io.deucalint:java-sdk:0.1.0` and uses Jackson.

```java
var analytics = new io.deucalint.sdk.DeucalInt(
  "http://127.0.0.1:8100", "pk_demo_deucalint");
analytics.track("purchase_completed", "visitor-123", Map.of("amount", 49));
analytics.flush();
```

A rejected Java flush retains the same queued event IDs. Retry explicitly; the Java SDK does not schedule background work or persist its queue. None of these SDKs has been published to a package registry.
