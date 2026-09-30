# ADR 004 — At-least-once delivery with stable event IDs

Status: accepted for the current development implementation.

## Decision

SDK retries preserve eventId. Local storage enforces (project,eventId) uniqueness. The warehouse uses ReplacingMergeTree and FINAL reads; consumers commit only after insertion.

## Consequences and limits

Do not claim exactly-once delivery. Distributed IDs and payloads must be immutable; changing timestamps across monthly partitions is not deduplicated by the current table design.
