# ADR 007 — Version the event envelope

Status: accepted for the current development implementation.

## Decision

Version 1 is explicit; unknown versions and event fields are rejected. Entire invalid batches fail before enqueueing.

## Consequences and limits

New schema versions need compatibility tests, dual readers and replay/migration policy rather than silently changing the contract.
