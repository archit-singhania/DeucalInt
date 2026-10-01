# DeucalInt — Glass makeover and technical delivery

Updated 2026-10-01. This is the current status; it supersedes earlier upgrade summaries.

**DeucalInt — Real-Time Behavioral Intelligence & Product Observability Platform**

“An AI-powered product intelligence platform that explains what changed, why it changed, and what evidence caused it.”

## What changed for the user

The latest refinement adds **14 route-specific palettes** (iris, lagoon, azure, orchid, copper, jade, periwinkle, mulberry, slate, coral, amber, aqua, amethyst, and terracotta). The shared glass shell remains consistent while headings, ambient color, primary actions, selected navigation, maps, and panel markers inherit each route's identity. A floating contextual dock switches between related destinations, compresses while scrolling down, expands on upward scroll/focus, and includes search. Desktop navigation can collapse to an icon rail. Mobile uses the bottom dock plus an All pages glass sheet with keyboard focus containment and Escape dismissal. This is a browser implementation inspired by Apple's design language, not a native iOS material renderer.

The workspace now uses an Apple-inspired glass visual system: silver and blue with subtle lavender highlights, translucent floating navigation, ambient gradients, rounded glass cards, and a midnight theme. This replaces the emerald design. Metrics lead the overview; the evidence prompt follows them. Connect your site sits in the top bar, Ask DeucalInt beside the page title, and export/refresh beside the filters. Login, setup, tables, dialogs, charts, maps, journeys, and settings share the new styling. Mobile uses a compact horizontal navigation dock and stacked content. Page entrances, dialogs, hover feedback, and loading skeletons respect reduced motion; opaque fallbacks support browsers without backdrop blur and increased contrast preferences. External font requests remain removed.

Setup is now **register a site → paste one snippet → verify real signals**. HTML, tag-manager and WordPress instructions share the same public loader. Pages, clicks, forms, navigation, errors, network requests, resource timing and Web Vitals are discovered after consent. The event library supports search and creating a funnel from an existing event. Custom business outcomes such as purchase completion still require a named event; the product does not claim it can infer every business event automatically.

Visual analytics now include:

- A locally bundled Natural Earth country map with real recorded-country counts, keyboard-accessible country list, and click-to-filter segments. Unknown locations remain unknown; there is no invented geolocation.
- Traffic comparison, hover/keyboard exploration, bucket details and a readable data table.
- A staged journey flow with weighted session links, keyboard selection, forward/backward anchors, exits, truncation notice and accessible tabular data.
- Exact-day and rolling retention, with cohort-cell numerator/denominator inspection and maturity limits.
- Guided connection verification that distinguishes real events from seeded sample data.
- Password changes and signed-webhook delivery status/retry controls in the workspace.

## Technical implementation delivered

| Area | Completed | Evidence / limits |
|---|---|---|
| Browser installation | Public ingest.js loader, consent-ready API, duplicate embed protection, DNT, automatic capture | Real cross-origin Chromium/WebKit SDK scenarios passed; no pre-consent collection |
| Identity/session continuity | Shared active-tab identity and session, idle expiry, cross-tab revocation, reload-safe per-tab queues | Tab close clears sessionStorage queues; durable disk delivery is not claimed |
| Account/session safety | Salted password hashing, durable hash-only sessions, expiry/logout, password rotation and revocation, secure cookies, CSRF, production configuration checks | Local control plane; no SSO/OIDC/MFA/recovery or distributed user management |
| Source setup | Website-origin registration bound to project token, setup diagnostics, discovered event catalog | Public HTTPS collector still required for an externally hosted site |
| Warehouse queries | Parameterized ClickHouse current/previous metrics, dense series and dimensions, tenant/AST/time bounds and query budgets | Java tests pass; Docker execution unavailable. Dashboard use is opt-in pending real SQL validation |
| Advanced analytics | Rolling retention and staged journey helpers, exposed in dashboard | Cohorts use first observation within selected history; no identity stitching/full-lifetime cohorts |
| Intelligence evaluation | Shared intent router plus repeatable fixture/evidence/detector evaluation | Intent 12/12, safe output 12/12, evidence 6/6; synthetic detector precision 95.24%, recall 100%. These are fixture results, not live/model quality claims |
| External alerts | Durable HMAC-signed HTTPS webhook outbox, retry limits, backoff, leases, dedupe IDs, SSRF defenses, manual retry | Mocked transport tests; no receiver configured or contacted. Email and distributed scheduler remain |
| Build/security integration | AOT, strict templates, CSP-compatible stylesheet loading, static JSON response fix, bundled map geometry, CI SDK browser test | Production build passes; no hosted CI/deployment run performed |

## Verification

- **64 Python/API tests passed** across pipeline, analytics, privacy, authorization, setup, sessions, lifecycle, delivery and static assets.
- **7 SDK unit tests passed**; SDK 5,754 bytes gzip, one-script loader 6,040 bytes gzip (both under 12 KiB).
- **13 Chromium UI scenarios verified**, including original dashboard regressions plus installation, event discovery, map filtering, keyboard dialogs, mobile, rolling retention, journey anchors, all route palettes and floating navigation.
- **8 WebKit makeover scenarios verified**, plus independent SDK integration in Chromium and WebKit.
- **9 Java tests passed; 2 Docker integration tests skipped.** Docker is absent. No distributed load/chaos result is claimed.
- Firefox binaries were installed for testing but failed to launch on this Windows host with `spawn UNKNOWN`; Firefox app behavior remains unverified.
- Final AOT assets: **365.96 KB raw, estimated 96.33 KB initial transfer**. Map geometry loads separately only when its component is used.
- Desktop/mobile screenshots were inspected. A full screen-reader/contrast audit and formal usability study remain.

## Remaining work, prioritized

1. **Execute distributed infrastructure tests.** Run real Kafka/ClickHouse integration, enable and compare warehouse aggregates, then measure load, query budgets, lag, outage recovery and restore behavior. This needs a Docker-capable host.
2. **Production identity and deployment.** Hosting and identity-provider choice were explicitly deferred by the user. Add the selected OIDC/SSO integration, organization/invitation/recovery flows, shared throttling, PostgreSQL control-plane management, TLS ingress, secrets, backup/restore and deployment automation.
3. **Replay completeness.** Current replay is privacy-safe geometry. Complete DOM/mutation playback, replay object storage, source maps, cross-store deletion and distributed presence are unfinished.
4. **Broader analytics.** Full-history identity-aware cohorts, saved cohorts, multivariate/statistical attribution, more warehouse-side analytical queries, server-side rollups and distributed alert scheduling remain.
5. **Real model and notification verification.** Run evaluation against the selected live model, broaden representative/adversarial fixtures, add multistep investigations and validate a configured webhook receiver. Add email if desired.
6. **Operational readiness.** OTel/log correlation, SLOs, vulnerability/container gates, network policy, HA, public deployment and registry publication remain.
7. **Final UX maturity.** Independent accessibility and usability review, Firefox coverage, visual regression baselines, component/route decomposition and CSS consolidation remain useful follow-up work. The makeover is implemented; “best in market” is not a claim these tests establish.

The full production roadmap is **not complete**. Substantial items were implemented and tested in this pass; infrastructure-dependent items are explicitly separated from code that is locally verified.

## Run and test manually

Run `npm ci`, `npm run build`, then `python apps/local-api/server.py`. Open http://127.0.0.1:8100. Local defaults: `owner` / `deucalint-local`, `viewer` / `deucalint-viewer`. Existing passwords are not overwritten by environment changes.

Follow [Manual testing](MANUAL_TESTING.md). The full phase inventory remains in [PHASES.md](PHASES.md), backend deployment controls in [SECURITY_DELIVERY.md](SECURITY_DELIVERY.md), analytics limits in [ANALYTICS_UPGRADE.md](ANALYTICS_UPGRADE.md), and browser installation in [SDK guide](../packages/web-sdk/README.md).
