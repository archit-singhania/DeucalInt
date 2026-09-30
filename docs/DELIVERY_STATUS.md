# DeucalInt delivery status — 2026-09-30

DeucalInt — Real-Time Behavioral Intelligence & Product Observability Platform

“An AI-powered product intelligence platform that explains what changed, why it changed, and what evidence caused it.”

## Delivered in this upgrade

- Angular AOT compilation and strict template checking; initial assets now 309.03 KB, estimated transfer 85.02 KB. SDK gzip size 5,153 bytes.
- Shared visual tokens, refined spacing/typography, SVG navigation, light/dark themes, responsive layouts, keyboard command search, dialog focus handling and reduced-motion support.
- Multi-rule AND segments, saved combined segments, previous-period traffic comparison, keyboard/hover chart exploration and bucket detail dialog.
- Editable/reorderable funnel steps and project-scoped investigation history, retaining exact evidence and query windows.
- Source onboarding and local project creation with one-time public token display.
- Local account creation with salted PBKDF2 password hashes, five project roles, membership listing/revocation, protected owner membership and server-side authorization. Existing sessions lose revoked project access immediately.
- Official web-vitals capture for new LCP, CLS, INP and TTFB events; synthetic/historical samples remain distinct from browser measurements.
- Local minute-based alert evaluation, minimum-session guards, durable cooldowns, persisted notification inbox and acknowledgement; 90-day notification retention.
- Slow checkout and explicitly synthetic high-LCP demo controls.
- Updated container build configuration, regression coverage, manual testing guide and phase status.

## Existing platform retained

Durable local ingestion, batching/retry SDKs, deduplication, privacy scrubbing, live SSE, metrics, funnels, retention, journeys, experiments, masked geometry replay, errors/performance, evidence-backed deterministic investigations, optional model planning, local erasure/token rotation, and distributed Java/Kafka/ClickHouse infrastructure code remain available. The 30-phase inventory is in PHASES.md.

## Verification

37 Python/API tests and 3 SDK tests pass. Production AOT build passes. Five Chromium browser tests cover analytics, evidence, real SDK ingestion, mobile layout, command search, theme, segments and comparison; final run recorded in VERIFICATION.md. Java's preceding verification recorded four passes and one Docker integration skip; Java code was unchanged in this upgrade.

## Still required technically

1. Run and repair full Docker Compose integration, broker failure/recovery and ClickHouse correctness/load tests. Docker is unavailable on this machine; manifests alone are not verification.
2. Implement production identity: OIDC/JWT, organizations, invitations, recovery, account linking/password changes, shared session/rate-limit storage and distributed membership/control-plane APIs. Local sessions are in memory; local accounts are not a public identity service.
3. Replace bounded raw-event retrieval with parameterized warehouse analytics and additional rollups; implement distributed presence, replay chunk storage and erasure across all stores/backups.
4. Extend geometry replay to DOM mutation playback, add resource timing/source maps, session coordination across tabs, SDK compression and broader browser coverage.
5. Add rolling/full-history cohorts, identity stitching, Sankey exploration, stronger anomaly/seasonality analysis, multi-step model orchestration and evaluated model behavior. Ollama is unavailable here. Correlation remains distinct from causation.
6. Extend alerts to distributed scheduling and authorized external email/webhook delivery, delivery retries and operational monitoring.
7. Add OTel traces/log aggregation, operational SLOs, distributed load/chaos measurements, container scanning, registry/deployment automation, HA/TLS/network policies and restore drills.
8. Publish and validate the public demo, SDK packages and hosted CI/deployment. No public deployment or registry publication was performed.

## UI work still worth completing

- Route/component decomposition and lazy loading as the application grows.
- Full retention cohort drill-down and interactive journey/Sankey exploration.
- Richer replay inspection and evidence-linked affected-session navigation.
- Consistent chart controls and accessible alternatives across every analytical visualization.
- Independent contrast/accessibility review, screen-reader tests, and Firefox/WebKit regression coverage.
- Replace remaining legacy Unicode controls with the shared icon component and consolidate legacy CSS with the new token layer.

These are real remaining implementation items, not features represented as complete. The result is an expanded, tested local platform; the entire production roadmap is not finished.

## Manual run

Run `npm ci`, `npm run build`, and `python apps/local-api/server.py`; open http://127.0.0.1:8100. Default local credentials are owner / deucalint-local or viewer / deucalint-viewer. Follow MANUAL_TESTING.md for functional, privacy, role, theme, chart, segment and alert scenarios. On this Windows machine use the npm.cmd binary under C:\Program Files\nodejs if the PowerShell npm shim fails.
