# ADR 009 — Use allowlisted tools and segment ASTs

Status: accepted for the current development implementation.

## Decision

Natural-language planning yields one of four named tools plus a validated segment expression. The model cannot supply SQL. Calculations and evidence are deterministic.

## Consequences and limits

The optional Ollama planner is not a full multi-step agent. A failed or unsupported plan must fail closed.
