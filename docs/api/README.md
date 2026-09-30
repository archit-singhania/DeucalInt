# API surface

The OpenAPI document covers the primary transport contracts. All `/api/*` routes except login require a local cookie session. `project` is checked against the authenticated session on every request. `days` accepts 1–90; `segment` accepts a URL-encoded allowlisted JSON AST.

| Route | Method | Result |
|---|---|---|
| `/health` | GET | Runtime profile |
| `/metrics` | GET | Prometheus metrics; keep private |
| `/api/login`, `/api/logout` | POST | Local development authentication |
| `/api/me`, `/api/projects` | GET | Current role and accessible projects |
| `/api/overview` | GET | Totals, time series, previous window, distributions |
| `/api/live` | GET | SSE; last five minutes, last 15 events |
| `/api/funnels` | GET | Steps JSON array, `ordered=true/false`, `window` in seconds |
| `/api/retention` | GET | Weekly first-observed cohorts; exact-day return |
| `/api/journeys` | GET | Frequent within-session transitions |
| `/api/sessions`, `/api/session?id=...` | GET | Latest 100 sessions / scoped event timeline |
| `/api/observability` | GET | Error groups, performance observations, deployments |
| `/api/anomalies` | GET | Rolling median/MAD conversion anomalies |
| `/api/investigate` | POST | Question → validated plan → evidence |
| `/api/experiments` | GET | Exposure conversion, Wilson intervals, two-proportion test |
| `/api/alerts` | GET/POST/DELETE | Last-day in-app rules; owner writes only |
| `/api/reports` | GET/POST/DELETE | Saved named segments; owner writes only |
| `/api/settings` | GET/POST | Local retention policy |
| `/api/token` | POST | Local token rotation; old token invalidated immediately |
| `/api/lifecycle` | DELETE | Visitor/session erasure, inbox purge, redelivery tombstone |
| `/api/export` | GET | JSON event export for current project, dates, segment |
| `/api/audit` | GET | Local retention/token/deletion audit records |

Distributed dashboard uses the same read endpoints through a Python adapter. The adapter requests data from Spring's token-scoped `/v1/events`; it does not silently fall back to the local sample database. Settings writes, lifecycle deletion and rotation explicitly return 501 in distributed mode until their cross-store implementations exist.

The local API's optional planner is enabled through `DEUCALINT_AI_URL` and `AI_SERVICE_TOKEN`. An unset `OLLAMA_URL` means deterministic planning. With Ollama configured, the planner validates a four-tool allowlist and the segment AST. Model-produced SQL is never executed. Metric calculation and claims remain deterministic.
