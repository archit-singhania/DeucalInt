# ADR 001 — Separate event analytics from metadata

Status: accepted for the current development implementation.

## Decision

PostgreSQL owns project/token metadata in distributed mode. ClickHouse owns event facts and rollups. The runnable local profile uses SQLite for both to reduce setup requirements.

## Consequences and limits

Local parity is explicit, not a claim that SQLite is the production warehouse. Dashboard saved configuration still needs migration into PostgreSQL.
