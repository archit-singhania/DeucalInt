# ADR 012 — Recover from durable boundaries

Status: accepted for the current development implementation.

## Decision

Local inbox rows survive process restarts. Poison rows go to deadletter. Distributed workers retry warehouse inserts and exit without committing after prolonged failure so orchestration can restart them.

## Consequences and limits

Testcontainers and outage scripts are supplied. No zero-loss distributed outage claim is made until the complete stack is exercised.
