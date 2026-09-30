# Analytics and warehouse upgrade — 2026-09-30

## Delivered and tested locally

The retention engine supports exact-day and rolling retention. Each cell now carries its eligible user count, retained user count and rate, and each cohort has an unambiguous UTC date ID. Unmatured cells remain null; future events and deployment records cannot create retention users. Rolling means a user returned on or after the selected day, within the available history. Cohorts still use the first activity **in the queried dataset**, not proven first-ever acquisition. Recent cohorts have less follow-up. Identity stitching and full-history acquisition cohorts remain unfinished.

The journey engine produces a directed, staged graph with session-weighted nodes and links, forward/backward exploration and an optional event/page anchor. Consecutive repeats collapse, but returning to the same page at a later stage remains visible. Sessions never connect to one another. Exits count observed path endings; clipped paths do not become false exits. The bounded graph exposes `truncated` when its depth or node quota omits paths. This is a graph of observed events, not complete user intent.

Nine Python behavior tests cover cohort maturity, exact versus rolling return, future-event exclusion, repeat/loop handling, session boundaries, backward anchoring, graph truncation and shared planner routing. Six FastAPI contract tests pass, including synonym routing and blank-question rejection.

## Warehouse query implementation

The Java analytics service provides `GET /v1/overview?days=7&segment=<encoded JSON AST>` with an `analytics:read` bearer token. The tenant comes from the token's server-side metadata. The endpoint returns the dashboard overview shape: current/previous metrics, dense comparison series, session-attributed browser/device/country breakdowns, page counts and sample-data status.

Two server-owned SQL templates aggregate inside ClickHouse instead of exporting up to 100,000 event bodies into Python. Tenant IDs, window boundaries and all segment values use typed ClickHouse parameters; dimension/operator names are allowlisted. Both queries read deduplicated `FINAL` events and reject invalid/oversized ASTs. Each query is limited to ten seconds, 512 MiB memory and ten million rows read, failing rather than returning a silent partial result. The endpoint adds a Micrometer duration timer. These are bounded raw-table aggregates, **not a claim of demonstrated warehouse-scale throughput** or an implementation of all analytic query types.

The dashboard adapter enables this endpoint only when `DEUCALINT_WAREHOUSE_OVERVIEW=1` in the distributed profile. Keep that opt-in disabled until the ClickHouse integration test has passed in the deployment environment. Other distributed analytical screens still use the bounded raw-event adapter.

`mvn -B verify` passed: **nine Java tests passed and two Docker tests skipped**. Five new unit tests cover binding/injection resistance, URL parameter encoding, invalid expressions, empty dense series and response mapping. A new `WarehouseContainerTest` uses ClickHouse 25.8 to check duplicate events, tenant isolation, sessions, conversion, bounce, duration, revenue, comparisons and segments. This test compiled but **did not run here** because no usable Docker daemon is available. The existing broker integration test also skipped. No distributed load, chaos, failover or SQL runtime benchmark was performed.

Query parameters follow the [ClickHouse typed-parameter interface](https://clickhouse.com/blog/whats-new-in-clickhouse-21-12). Exact cardinality can require large aggregation states; read/memory bounds are intentional and must be tuned from actual workload measurements, as discussed in [ClickHouse's aggregation scaling analysis](https://clickhouse.com/blog/clickhouse-parallel-replicas).

## Intelligence evaluation

Run `python tests/evaluate_intelligence.py --output docs/INTELLIGENCE_EVAL.json` using the development Python environment. This produces a measured report rather than a hardcoded success claim. The checked-in run uses deterministic planning:

| Check | Measured result |
| --- | --- |
| Planner intent routing | 12 of 12 synthetic prompts correct |
| Validated safe planner output | 12 of 12 |
| Unauthenticated planner rejection | Passed |
| MAD anomaly precision | 95.24%: 60 true positives, 3 false positives |
| MAD anomaly recall | 100%: 60 injected drops, zero missed |
| Small-sample suppression | Zero violations in 30 scenarios |
| Evidence consistency | 6 of 6 assertions passed |

The detector fixtures contain 3,000 buckets with seeded mild noise, occasional weekly variation and isolated 16-point conversion drops. Those scores do not establish accuracy on live customer traffic, sustained shifts, stronger seasonality or causal explanations. The initial planner evaluation found three misses for slow requests, browser crashes and releases. A shared, word-boundary intent router now handles those synonyms consistently in local and FastAPI entrypoints. All twelve fixtures pass after that change; unknown questions still fall back to metric comparison, and this small regression set does not establish general natural-language understanding.

Set `OLLAMA_URL` and optionally `OLLAMA_MODEL`, then add `--model` to evaluate the same prompt set against a reachable configured model. That mode fails explicitly when no endpoint is configured. **No Ollama/model quality result is claimed in this delivery.** Broader adversarial prompts, model/version tracking, representative domain fixtures, multistep investigations and evaluation against human-labelled outcomes remain necessary.

## Follow-up validation

1. On a Docker host, run `mvn -B verify` and require the warehouse and broker tests to execute, not skip.
2. Bring up the distributed Compose profile, enable the warehouse overview opt-in and compare every metric against the same local fixture dataset.
3. Measure concurrency, query latency, memory, ingestion lag and failure recovery across realistic volumes. Extend materialized aggregates for validated bottlenecks.
4. Run the model evaluation against the exact deployment model, keep failing fixtures, expand the dataset and review false positives.
5. Preserve visible retention history limits and journey truncation in the dashboard. Neither feature provides full-history identity resolution.
