# ADR 008 — Minimize before transmission

Status: accepted for the current development implementation.

## Decision

The browser never captures input values or raw text. Sensitive fields are recursively scrubbed. The collector repeats scrubbing. Replay transports inert masked geometry.

## Consequences and limits

Pattern-based scrubbing is not a guarantee against arbitrary PII in custom properties. Customers must send minimized pseudonymous properties; a production allowlist is recommended.
