# Threat model and development boundaries

## Assets and trust boundaries

Protected assets include behavioral events, identifiers, replay geometry, ingestion/read credentials, project configuration, and investigation evidence. Boundaries are customer browser → collector, collector → broker, broker → warehouse, authenticated client → query API, and API → optional model planner.

## Current controls

| Abuse case | Implemented boundary |
|---|---|
| Tenant spoofing in an event | projectId is rejected; project comes from ingestion credentials |
| Reading another project | Session project allowlist or project-bound read token |
| Viewer changing configuration | Server-side owner checks, not only disabled UI buttons |
| Oversized or malformed batches | 512 KiB limit, 1–100 events, schema/type/time checks |
| Token leakage through instrumentation | No input capture; nested credential scrubbing; URL query removal |
| Malicious replay markup | Raw HTML is never transmitted/rendered; inert geometry only |
| SQL/model injection | Fixed SQL shape, encoded project literal, bounded numeric range; allowlisted planner tools/AST |
| Repeated delivery | Stable IDs, local uniqueness, warehouse FINAL reads |
| Deleted visitor reappears from queued data | Local inbox purge and tombstones |
| Cross-origin credentialed writes | Exact origin allowlist, HttpOnly SameSite=Strict sessions |
| Collector exhaustion | Bounded batches and per-project in-process rate limits |

## Limits before production

The local HTTP server and prefilled credentials are development conveniences. Use a reverse proxy with TLS, secure cookies, request/connection limits, OIDC/JWT authentication and real memberships for public deployment. Session and rate-limit state are in-memory and not shared across nodes. Read/query rate limiting and resource budgets require hardening. Never expose metrics, broker, warehouse or database ports publicly.

Arbitrary custom event properties may still contain PII despite pattern scrubbing. Use a property allowlist and pseudonymous IDs. Source maps, IP enrichment, geolocation and raw input recording are not implemented. All geographic sample values are synthetic; the SDK does not infer visitor country.

Distributed erasure must cover raw data, rollups, broker retention, replay objects and backups; that workflow is not yet supplied. Demo token values in seed SQL are intentionally public development credentials, not production secrets. Infrastructure images require scanning and patch review before deployment. Kubernetes manifests are for a local demo, not an audited multi-tenant cluster.

## Validation evidence

Tests cover tenant injection, query isolation, viewer writes, origin rejection, token rotation, nested privacy fields, invalid batches, geometric replay, deduplication and deletion redelivery. These tests are not a penetration test or a compliance certification.
