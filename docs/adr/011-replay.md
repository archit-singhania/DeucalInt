# ADR 011 — Start with masked geometric playback

Status: accepted for the current development implementation.

## Decision

Snapshots contain node tags and bounded rectangles. The player uses positioned inert elements and never executes recorded HTML or scripts.

## Consequences and limits

This intentionally limited replay is not full DOM fidelity. Object-store chunking, cursor overlays and richer mutation transport are future work.
