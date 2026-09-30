# ADR 010 — Monthly event partitions and tenant/event ordering

Status: accepted for the current development implementation.

## Decision

Events use monthly partitions, a tenant/event sort key and 90-day TTL. Minute aggregate states retain exact unique event IDs to resist duplicate delivery within a bucket.

## Consequences and limits

FINAL queries are correctness-first and may become expensive. Event IDs must preserve their original timestamp; full distributed deletion must update derived data too.
