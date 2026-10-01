# Manual test guide

## 1. Start and sign in

From the repository root run `npm ci`, `npm run build`, then `python apps/local-api/server.py`. Open **http://127.0.0.1:8100**. On Windows, use `C:\Program Files\nodejs\npm.cmd` if your global npm shim is broken.

Choose Owner, leave the prefilled `deucalint-local` password, and enter the workspace. Expected: Overview loads, the connection becomes healthy, and **Sample + captured data** identifies the seeded commerce data. Metrics are calculated from stored events and change with time; the guide intentionally does not promise fixed totals.

## 2. Overview and filters

Check the new glass design in both themes using the moon/sun control. At desktop width, navigation should float on the left, metrics should appear before the insight prompt, and export/refresh should sit beside the filters. Collapse/expand the rail using its top button. Visit every page: its accent, ambient color, selected controls and primary actions should change together. The floating bottom dock should show related destinations; scroll down to compress it and up to expand it. At 390px width, tap Pages to open all destinations, choose a page, and confirm the sheet closes. Escape should dismiss the sheet and return focus to Pages. Cards should stack without horizontal page overflow. Try keyboard Tab navigation, open/close search with Ctrl+K/Escape, and enable your operating system's reduced-motion preference; entrances and transitions should stop. Use Connect your site in the top bar to check installation styling.

1. Switch between 24 hours, 7 days, and 30 days. Totals and trend points should change.
2. Choose Safari, then Chrome. Metrics, top pages, investigations and subsequent pages should use the chosen browser filter.
3. Choose **Empty sandbox**. Before any testing it should show zero totals and helpful empty states.
4. Switch back to Northstar Commerce; choose All browsers and 7 days.
5. Export data. Confirm the downloaded JSON is restricted to the current project, range and browser.

## 3. Evidence-backed investigation

1. Click **Investigate changes** or **Ask DeucalInt**.
2. Ask `Why did checkout conversion drop?`.
3. Expected: baseline/current conversion, errors, p95 latency, supported segments, sample counts and a correlation caveat.
4. Open a **Conversion comparison** evidence card. Inspect the query values and exact comparison window; export underlying events if desired.
5. Ask `What changed in API latency?` and confirm the summary addresses latency.
6. Ask `Why did Safari checkout conversion drop?`. The planned browser segment narrows the evidence.
7. Ask an unsupported question, such as `What is the weather?`. Expected: an explicit supported-question response, not invented analytics.

The default engine is deterministic, clearly labeled in the UI. It does not pretend a language model was called.

## 4. Product analytics

**Funnels:** inspect the purchase funnel. Change the window to 5 minutes, edit the comma-separated event names, then Apply. Change to unordered mode. Counts should never increase at later steps. Save a named browser segment and reopen it using the saved-segment menu.

**Retention:** use 30 or 90 days. Inspect D0, D1, D3, D7, D14 and D30 cells. D0 is 100%; a dash means the cohort has not matured. Cohorts are first observed within the selected range, not full-lifetime acquisition cohorts.

**Journeys:** inspect transitions and their frequencies. Changing browser/project should change the edges or produce an empty state.

**Experiments:** inspect variants, visitors, conversions, Wilson intervals and p-value. This is observational exposure analysis; the UI must not claim a causal winner.

## 5. Generate real activity

1. Choose Empty sandbox, then **Demo commerce**.
2. Before enabling tracking, click Add to bag. No SDK event should be sent.
3. Click **Enable tracking**. Add to bag again, then **Complete checkout**.
4. Open **Live activity**. Within approximately 2–5 seconds, expect `page_view`, `product_viewed`, `checkout_started`, and `purchase_completed` events.
5. Visit Sessions & replay and find the new session. It should contain actual generated timestamps and events.
6. Return to the demo store; select **Simulate payment regression**, add to bag, and checkout. Expect a failure message, `PaymentFormError`, failed network timing, and a deployment event.
7. Open Errors & performance. Confirm the error group and failed request appear. Refresh if ingestion is still processing.

The store is a simulator. No payment details are collected and no money is charged. A single failed session is not enough to demonstrate statistically reliable anomaly detection; use a larger dataset for that.

## 6. Replay and privacy

1. In Sessions & replay, choose a session with **Replay**.
2. Press Play, pause, and scrub the range control. The event highlight should move.
3. Advance to a `snapshot` event. Expect a masked geometric layout, not a pixel-perfect copy of the webpage.
4. Check the `/v1/batch` payload in browser developer tools. No password, card value, form input text, or raw HTML should be captured.
5. Disable demo tracking. Further clicks must not create SDK events. An already dispatched HTTP request cannot be recalled.

## 7. Alerts and access control

1. Create an errors alert with threshold 0 in a project with a captured error. Expected: Triggered.
2. Remove the alert. Reload and confirm it stays deleted.
3. Sign out. Sign in as Viewer using `deucalint-viewer`.
4. Expected: dashboards remain readable; mutation controls are disabled, and a direct settings POST is rejected server-side.
5. Sign out and return as Owner.

## 8. Lifecycle tests (use the sandbox)

1. Capture a sandbox session and copy its exact session ID from the session explorer.
2. In Project settings, select Session ID and enter that identifier. Delete and confirm.
3. Refresh Sessions. The session must be gone; re-delivering the same session ID must not resurrect it.
4. Change retention and save. Cleanup runs once a minute.
5. Rotate the public token only when you are ready to update any connected SDKs. The old token must stop accepting events. Copy the new token immediately.

Visitor/session erasure, token rotation and policy writes are local-profile features. The distributed profile explicitly rejects these writes with 501 rather than claiming they worked.

## 9. Responsive and failure states

Test widths of 1440, 900 and 390 pixels. On narrow screens navigation becomes horizontally scrollable; tables scroll within their panels. Main page content must not create horizontal page overflow.

Stop the Python server. The live connection should indicate reconnection; refreshing a page should show an error. Restart the server, sign in again (sessions are in memory), and confirm stored events/reports still exist.

## 10. Distributed pipeline (requires Docker)

```sh
docker compose --profile distributed up --build
python tests/integration/distributed_smoke.py
```

Open **http://127.0.0.1:8200**, not 8100. This dashboard reads ClickHouse through the Java API and starts without sample events. Generate events through its demo store or run:

```sh
python benchmarks/synthetic-generator/generate.py --endpoint http://127.0.0.1:8080 --token pk_demo_deucalint --sessions 30
```

Check collector readiness at `:8080/ready`, API readiness at `:8081/ready`, and broker/processor logs. The smoke test delivers the same event twice and expects only one analytical event.

For a controlled outage, run `tests/chaos/dependency-outage.ps1 -Service clickhouse -Seconds 20` from the root. Submit events during the outage, inspect backlog/retry metrics, and verify recovery. This test was supplied but not run on the development machine because Docker is unavailable.

## 11. Optional model

Create a virtual environment and install `apps/ai-engine/requirements.txt`. Run Uvicorn with `AI_SERVICE_TOKEN` configured. Point `DEUCALINT_AI_URL` at that service and set the same token on the local API. Without `OLLAMA_URL` it plans deterministically. With Ollama running and a compatible installed model, set `OLLAMA_URL` and `OLLAMA_MODEL` on the intelligence service.

The model may choose only a named tool and a validated segment. Dashboard evidence is still computed from authorized events. A bad model plan must fail rather than execute arbitrary SQL.


## Premium UI and access upgrade

1. Use the moon/sun button; reload and verify the selected theme persists. Check both themes at desktop and 390px mobile widths.
2. Press Ctrl+K (Cmd+K on macOS), search Team, and open it. Escape closes the dialog; Tab stays inside an open dialog.
3. On Overview, enable Previous period. Hover the chart, or focus it and use arrow keys; Enter opens bucket values.
4. Click Build segment, Add rule, select device equals mobile, and Apply. Combine with a browser filter. Remove the chip to reset. Save/reopen the combined segment on Funnels.
5. On Funnels, reorder/edit/add steps, then Apply. Counts should follow the new event order.
6. Run an investigation, leave and return. Recent investigations should restore their original result and window.
7. Open Connect a source, create a uniquely named test project, and copy the displayed token. Its overview starts empty. Use that token in the Demo store to verify capture.
8. In Team & access, create an analyst with a unique username and a password of at least 12 characters. Sign out and enter those credentials. The account sees only its assigned project, can save reports, and cannot rotate tokens or change retention. Sign in as owner, revoke that member, and verify its existing session loses project access.
9. In Demo store, enable slow checkout and synthetic high LCP, then checkout. The LCP fault is deliberately generated demo telemetry, not an actual browser measurement.

Local account passwords are hashed with salted PBKDF2. Seed owner/viewer credentials are initialized when accounts are first created; changing environment defaults later does not reset an existing account. Sessions are stored as hashes and expire after eight hours or explicit revocation. Invitation, password reset and OIDC flows are not implemented.

## Scheduled alerts

Create an errors rule with threshold 0, minimum sessions 1, and cooldown 60 minutes in a project with captured errors. Wait up to one minute, then refresh Alerts. Expect one inbox notification. Acknowledge it; refresh again and verify acknowledgement persists. The scheduler must not issue another notification during cooldown. A project below the minimum sample shows Awaiting sample. Rules use the entire project over 24 hours, independently of dashboard filters. Signed webhook delivery is now available when explicitly configured by the workspace operator; distributed scheduling remains unavailable.

## Studio makeover — guided installation and visual checks

1. Open **Connect a source**. Register a website origin such as `https://your-site.example` (no path). For local testing use an HTTP localhost origin. Owner/admin can save a source; a viewer cannot.
2. Choose HTML, Tag manager or WordPress. Copy the generated snippet using your project's public token. New projects show their token once; an existing rotated token must be pasted or rotated again deliberately.
3. Leave **My site has already received analytics consent** unchecked unless consent has actually been obtained. No capture occurs by default. Connect your consent UI to `window.deucalint.consent(true)` (after `deucalint:ready` if the loader is not yet ready), and call with false on withdrawal. See the SDK README for a race-safe example.
4. Open the instrumented site, grant consent, navigate and click. Use **Check connection**. Real-event count and last-signal time should update. Seeded demo data alone must not show a connection as verified. Public sites require a publicly reachable HTTPS collector; localhost is only reachable on this computer.
5. Open **Auto-captured events**, search a name, and use **Build funnel**. Automatic capture does not require manual definitions. Purchase/revenue outcomes still need an explicit business event.
6. On Overview inspect the country map. Select a country using its keyboard-accessible list; a country segment chip appears and server-scoped metrics update. Missing location is Unknown, not an inferred location. Toggle **View data** for traffic's accessible table.
7. On Journeys select a node with keyboard Enter. Inspect links and exits. Choose **What happened before**, enter `purchase_completed` as anchor, and inspect the preceding steps. Open **View accessible journey data**. Truncation is disclosed.
8. On Retention switch **On this day** / **On or after**. Click a cohort cell to see retained and eligible counts. Immature cells remain unavailable.
9. In Settings change the password only on a disposable test account. Use a different password of at least 12 characters. Confirm the current session remains valid and another signed-in session is revoked. Store the new password; no recovery flow exists yet.
10. With an operator-configured HTTPS webhook receiver, trigger an alert. Inspect **Webhook delivery activity**, verify signature/idempotency at the receiver, and retry a dead entry after correcting the receiver. External delivery was not exercised in this workspace; configuration and mocked test evidence are documented in SECURITY_DELIVERY.md.
11. Test both themes at desktop and 390px width. Press Tab from the start to find **Skip to content**. Ctrl/Cmd+K opens search; Tab remains in the dialog; Escape closes it and returns focus. Reduced-motion preferences suppress animation.

Sessions are now stored as token hashes in SQLite and survive API restarts until expiry/revocation. This replaces the original in-memory session implementation. Public deployment and identity-provider integration remain deferred.
