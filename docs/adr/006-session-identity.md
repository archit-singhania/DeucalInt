# ADR 006 — Use pseudonymous visitor and session identifiers

Status: accepted for the current development implementation.

## Decision

The browser SDK stores a random visitor ID and renews its in-memory session after 30 minutes of inactivity. Events carry both identifiers.

## Consequences and limits

Cross-tab and cross-reload session coordination and identify-to-anonymous merging are not implemented. Do not assume one person always equals one stored visitor.
