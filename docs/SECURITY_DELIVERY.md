# Authentication, source verification, and alert delivery

These changes strengthen the runnable local profile. They do not turn the Python standard-library server and SQLite control plane into a production identity platform. Hosting and external identity-provider integration remain deferred.

## Implemented and checked

- Session credentials are 256-bit random values. Only SHA-256 token hashes are stored in `auth_sessions`, alongside the account, creation time, and an eight-hour expiry. Sessions survive a process restart, expire durably, and are capped at ten per account. `LOGIN` remains an empty compatibility variable for older tests; it is never used for authentication.
- Every authenticated request reloads project membership. Distributed query credentials no longer grant an account access to every configured project. Revoking membership also terminates an active event stream on its next authorization check.
- Cookies use `HttpOnly`, `SameSite=Strict`, and a root path. Production mode requires `Secure`. Logout requires POST and deletes the durable session. Password changes verify the current password, replace the salted PBKDF2-HMAC-SHA256 verifier, revoke every old session, and return a new session. A concurrent password change cannot create a valid session from a stale successful login check.
- Account writes reject unapproved origins and browser requests marked cross-site. Login and password change have bounded attempt rates. Account passwords remain local credentials; provider login, MFA, recovery, and organization provisioning have not been added.
- Responses include MIME-sniffing protection, clickjacking protection, and a same-origin Content Security Policy for the dashboard. Secure-cookie mode also emits HSTS. Error responses close the HTTP connection so an unread rejected request body cannot become another request. Chunked request bodies are explicitly rejected.
- Source setup reports stored event types, real event count, and the last real event timestamp. Seeded sample events never mark a source as connected. The event catalog derives event names and counts from actual stored events, scoped to the selected project and time range.
- An owner/admin may register an HTTPS website origin through project settings. HTTP loopback origins are allowed for local testing. Browser ingestion from that origin must also use that project's ingestion token. Registering a source does not add it to the dashboard's allowed account origins.
- Web Vital percentiles now ignore events that do not contain the measured vital, so separately emitted LCP and CLS measurements do not dilute each other with artificial zero values.

## API contracts

| Endpoint | Behavior |
| --- | --- |
| `POST /api/account/password` | Body: `currentPassword`, `newPassword` (12–1,024 characters, different from current). Rotates current session; revokes all old sessions. |
| `POST /api/logout` | Revokes the current stored session and clears its cookie. |
| `GET /api/me` | Returns role, username, and expiry timestamp. No session credential. |
| `POST /api/settings?project=…` | Accepts optional `retention` and/or `websiteUrl`. Website must be an origin, without credentials, query, fragment, or page path. |
| `GET /api/setup?project=…` | `connected`, `eventCount`, `realEventCount`, `lastEventAt`, `lastRealEventAt`, `eventTypes`, `websiteUrl`, collector base/path, `/ingest.js` SDK URL, and consent/replay metadata. No ingestion token. |
| `GET /api/events/catalog?project=…&days=7` | Actual name/type counts, unique sessions, last-seen time; returns at most 200 name/type groups and explicitly reports truncation. Optional segment filtering. |
| `GET /api/deliveries?project=…` | Owner/admin delivery states, attempt counts, retry time, and sanitized error. No destination credentials or payload. |
| `POST /api/deliveries?project=…` | Owner/admin may retry a dead delivery by its `id`. Delivered entries are not resent. |

The capture script is public; accounts and setup/catalog data require sign-in. Ingestion tokens are deliberately public write-only source credentials, not account authentication. The script starts capture only after consent; replay remains an additional opt-in. A real website still needs the one script tag (or an equivalent tag-manager installation) and its consent integration.

For local setup, connection status covers retained data. In distributed mode, status and catalog still use the bounded raw-event adapter and its supplied time window. Distributed website registration and source provisioning remain unavailable.

## Production startup gates

Set `DEUCALINT_ENV=production` only behind an HTTPS reverse proxy. Before opening the listener, the server requires:

| Setting | Requirement |
| --- | --- |
| `DEUCALINT_SECURE_COOKIES` | `1` (also the production default). |
| `DEUCALINT_PUBLIC_URL` | The canonical HTTPS origin, such as `https://analytics.example.com`. |
| `DEUCALINT_ORIGINS` | Explicit comma-separated HTTPS dashboard origins, including the public URL. Do not include customer source origins here. |
| `DEUCALINT_PASSWORD` | Unique bootstrap owner password of at least 16 characters. |
| `DEUCALINT_VIEWER_PASSWORD` | Unique bootstrap viewer password of at least 16 characters. |
| `DEUCALINT_DEMO_TOKEN` | Unique bootstrap source token of at least 24 characters. |
| `DEUCALINT_SANDBOX_TOKEN` | Unique bootstrap source token of at least 24 characters. |

Production mode disables automatic sample seeding. It also checks the existing database for the known development passwords and source tokens and refuses to start if they remain. Environment variables seed new records only: changing an environment variable does not rotate a credential already stored in the database. Use password change and token rotation before moving an existing development database into a production configuration.

The repository's Compose configuration is a local development topology. It does not automatically forward every optional environment variable above; a deployment manifest must explicitly provide its chosen settings and protected persistent storage. No hosting account, domain, certificate, reverse proxy, or external identity provider was provisioned in this work.

## Optional outbound alert delivery

Delivery is disabled by default. There is no default recipient. An operator explicitly configures a project-keyed JSON object in `DEUCALINT_WEBHOOKS`, with a `url` and a `signingSecret` containing at least 32 characters per destination. `DEUCALINT_WEBHOOK_ALLOWED_HOSTS` is a comma-separated exact-hostname allowlist. Put actual secrets in the deployment's secret store, never in source control or public frontend configuration.

Example structure, using placeholders only:

```json
{
  "your-project-id": {
    "url": "https://alerts.example.com/deucalint",
    "signingSecret": "REPLACE_WITH_A_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS"
  }
}
```

Only configured projects enqueue new alert deliveries. Existing historical notifications are not backfilled. Enqueueing happens in the same transaction as the in-app notification, after the sample minimum and persisted rule cooldown checks.

The dispatcher uses a separate worker so slow destinations cannot block event processing. It leases durable records for 120 seconds, makes up to six attempts with exponential backoff and jitter, and keeps sent/dead delivery metadata for 90 days. Network failures, HTTP 408/429, and server failures retry. Other HTTP 3xx/4xx responses become dead deliveries. Redirects are never followed. Owner/admin retries reset a dead entry's attempt count while retaining its delivery ID.

Destination checks require HTTPS on port 443, an explicitly allowed hostname, and exclusively public non-multicast DNS addresses. The TCP connection is pinned to the validated address while TLS verifies the original hostname. The sender does not use system proxies, follow redirects, or log destination secrets. An invalid destination becomes a sanitized configuration failure. Operator-controlled egress filtering is still recommended for an actual deployment.

Each request contains:

- `Idempotency-Key`: a stable notification/delivery ID.
- `X-DeucalInt-Timestamp`: the Unix timestamp for that delivery attempt.
- `X-DeucalInt-Signature`: `sha256=` followed by HMAC-SHA256 of `timestamp + "." + exact request body`, using the configured signing secret.

The receiver must verify the signature with a constant-time comparison, reject stale timestamps, and deduplicate the idempotency key. Delivery is at least once: a process failure after the receiver accepts a request can cause the same ID to be sent again. Payloads contain aggregate metric/threshold/sample information and project/rule IDs, not replay or raw visitor events.

No external destination was configured or contacted during implementation or testing. This implementation does not yet provide email, Slack-specific formatting, per-rule destinations, a delivery configuration UI, provider credentials, a distributed alert scheduler, or a production queue service.

## Verification and remaining limits

Run the Python regression suite with:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py' -v
```

`tests/test_security_delivery.py` covers hash-only durable sessions, expiry/logout, password changes and concurrent rotation, project isolation under distributed credentials, source origin/token binding and preflight, sample-versus-real connection status, catalog scoping, CSRF rejection, startup gates, Web Vital measurement isolation, webhook retry limits/redirect rejection/signatures/private-address rejection, and disabled delivery. Webhook transport is mocked: these are behavioral and security checks, not proof of external provider deliverability.

Final regression run on 2026-09-30: **63 Python tests passed**, including 15 security/setup/delivery tests. The run includes the analytics and FastAPI contract suites; it does not include Docker, browser, or external-provider tests.

Remaining work includes external identity (SSO/OIDC, MFA, recovery, invitation verification, account disablement), distributed control-plane APIs, scalable/shared authentication throttles, a production application server, TLS termination, deployment secrets and backups, restore drills, deployment-specific CSP review, service-level monitoring, and external delivery integration tests. `/metrics` must remain on a private network or be blocked/protected by the reverse proxy. SQLite control-plane files need restricted filesystem permissions and backup/retention policy. The production gates reject known unsafe defaults; they are not a claim that production readiness or a security audit is complete.
