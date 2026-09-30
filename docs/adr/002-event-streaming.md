# ADR 002 — Acknowledge durable ingestion before analytics

Status: accepted for the current development implementation.

## Decision

The distributed collector returns 202 after Kafka acknowledgement, not after a warehouse insert. The local profile commits an inbox transaction before acknowledging.

## Consequences and limits

Query visibility is eventually consistent. 202 is an acceptance promise, not immediate analytical visibility.
