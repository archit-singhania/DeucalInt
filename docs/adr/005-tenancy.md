# ADR 005 — Derive the project from credentials

Status: accepted for the current development implementation.

## Decision

Collectors resolve tokens to a project and reject client-supplied projectId. Local query routes check authenticated project membership. Distributed read tokens bind directly to one project.

## Consequences and limits

Development roles are owner/viewer with configured project membership. OIDC, JWT validation and real organization provisioning remain.
