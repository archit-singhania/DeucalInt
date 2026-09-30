"""Security and setup contracts. Network delivery is mocked; no webhook is sent."""

import http.cookiejar
import json
import os
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

from test_platform import s, event


class SecurityDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        s.DB = Path(self.tmp.name) / "test.db"
        s.init_db(False)
        s.RATES.clear()
        self.http = s.ThreadingHTTPServer(("127.0.0.1", 0), s.Handler)
        self.http.daemon_threads = True
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.base = "http://127.0.0.1:" + str(self.http.server_port)
        self.jar = http.cookiejar.CookieJar()
        self.client = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar)
        )

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        self.tmp.cleanup()

    def request(self, path, data=None, method=None, client=None, headers=None):
        req = urllib.request.Request(
            self.base + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers={"Content-Type": "application/json", **(headers or {})},
            method=method,
        )
        try:
            with (client or self.client).open(req, timeout=3) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            with error:
                return error.code, json.load(error)

    def login(self, client=None, password="deucalint-local"):
        self.assertEqual(
            self.request(
                "/api/login", {"username": "owner", "password": password}, client=client
            )[0],
            200,
        )

    def test_sessions_are_hashed_durable_expiring_and_revocable(self):
        self.login()
        raw = next(iter(self.jar)).value
        with s.connect() as c:
            stored = dict(c.execute("SELECT * FROM auth_sessions").fetchone())
        self.assertEqual(stored["token_hash"], s.hashed(raw))
        self.assertNotIn(raw, json.dumps(stored))
        s.LOGIN.clear()
        s.init_db(False)
        self.assertEqual(self.request("/api/me")[0], 200)
        with s.connect() as c:
            c.execute("UPDATE auth_sessions SET expires=?", (time.time() - 1,))
        self.assertEqual(self.request("/api/me")[0], 401)
        self.login()
        self.assertEqual(self.request("/api/logout", {})[0], 200)
        self.assertEqual(self.request("/api/me")[0], 401)

    def test_password_change_revokes_other_sessions_and_rotates_current(self):
        self.login()
        other = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )
        self.login(other)
        raw = next(iter(self.jar)).value
        self.assertEqual(
            self.request(
                "/api/account/password",
                {"currentPassword": "bad", "newPassword": "new-test-password-123"},
            )[0],
            403,
        )
        self.assertEqual(
            self.request(
                "/api/account/password",
                {
                    "currentPassword": "deucalint-local",
                    "newPassword": "new-test-password-123",
                },
            )[0],
            200,
        )
        self.assertNotEqual(next(iter(self.jar)).value, raw)
        self.assertEqual(self.request("/api/me")[0], 200)
        self.assertEqual(self.request("/api/me", client=other)[0], 401)
        self.assertEqual(
            self.request(
                "/api/login",
                {"username": "owner", "password": "deucalint-local"},
                client=other,
            )[0],
            403,
        )
        self.login(other, "new-test-password-123")

    def test_distributed_credentials_do_not_grant_other_project_memberships(self):
        self.login()
        self.request(
            "/api/members?project=demo",
            {
                "username": "restricted",
                "password": "test-password-123",
                "role": "viewer",
            },
        )
        viewer = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )
        self.assertEqual(
            self.request(
                "/api/login",
                {"username": "restricted", "password": "test-password-123"},
                client=viewer,
            )[0],
            200,
        )
        with patch.object(s, "DISTRIBUTED", True), patch.dict(
            os.environ,
            {
                "DEUCALINT_QUERY_TOKENS": '{"demo":"demo-secret","sandbox":"sandbox-secret"}'
            },
        ):
            self.assertEqual(
                [r["id"] for r in self.request("/api/projects", client=viewer)[1]],
                ["demo"],
            )
            self.assertEqual(
                self.request("/api/overview?project=sandbox", client=viewer)[0], 403
            )

    def test_setup_verifies_real_events_and_catalog_and_scopes_website_origin(self):
        self.login()
        self.assertFalse(self.request("/api/setup?project=sandbox")[1]["connected"])
        origin = {"Origin": "https://store.example"}
        batch = {"projectToken": "pk_sandbox_deucalint", "events": [event(typ="page")]}
        self.assertEqual(self.request("/v1/batch", batch, headers=origin)[0], 403)
        self.assertEqual(
            self.request(
                "/api/settings?project=sandbox",
                {"websiteUrl": "https://store.example/"},
            )[0],
            200,
        )
        preflight = urllib.request.Request(
            self.base + "/v1/batch", method="OPTIONS", headers=origin
        )
        with self.client.open(preflight) as response:
            self.assertEqual(
                response.headers["Access-Control-Allow-Origin"], "https://store.example"
            )
        self.assertEqual(self.request("/v1/batch", batch, headers=origin)[0], 202)
        self.assertEqual(
            self.request(
                "/v1/batch",
                {**batch, "projectToken": "pk_demo_deucalint"},
                headers=origin,
            )[0],
            403,
        )
        s.consume_once()
        setup = self.request("/api/setup?project=sandbox")[1]
        self.assertTrue(setup["connected"])
        self.assertEqual(setup["realEventCount"], 1)
        self.assertEqual(setup["sdkUrl"], "/ingest.js")
        self.assertNotIn("pk_sandbox_deucalint", json.dumps(setup))
        self.assertEqual(
            self.request("/api/events/catalog?project=sandbox")[1]["events"][0][
                "count"
            ],
            1,
        )
        self.assertEqual(
            self.request("/api/events/catalog?project=demo")[1]["events"], []
        )

    def test_sample_data_does_not_mark_source_as_connected(self):
        self.login()
        self.request(
            "/v1/batch",
            {
                "projectToken": "pk_demo_deucalint",
                "events": [{**event(), "context": {"sample": True}}],
            },
        )
        s.consume_once()
        data = self.request("/api/setup")[1]
        self.assertEqual(data["eventCount"], 1)
        self.assertFalse(data["connected"])
        self.assertIsNone(data["lastRealEventAt"])

    def test_account_csrf_and_unsafe_website_are_rejected(self):
        self.login()
        self.assertEqual(
            self.request(
                "/api/settings",
                {"retention": 7},
                headers={"Sec-Fetch-Site": "cross-site"},
            )[0],
            403,
        )
        for website in (
            "javascript:alert(1)",
            "http://example.com",
            "https://user:pass@example.com",
            "https://example.com?secret=1",
            "https://example.com:0",
            "https://bad host.example",
            "https://example.com\\@evil.example",
        ):
            self.assertEqual(
                self.request("/api/settings", {"websiteUrl": website})[0], 400
            )

    def test_password_reset_racing_login_does_not_issue_stale_session(self):
        original = s.password_hash

        def rotated_during_verification(password, salt):
            result = original(password, salt)
            with s.connect() as c:
                c.execute(
                    "UPDATE accounts SET password=? WHERE username='owner'",
                    (original("changed-concurrently", salt),),
                )
            return result

        with patch.object(s, "password_hash", side_effect=rotated_during_verification):
            self.assertEqual(
                self.request(
                    "/api/login", {"username": "owner", "password": "deucalint-local"}
                )[0],
                403,
            )
        with s.connect() as c:
            self.assertEqual(
                c.execute("SELECT count(*) FROM auth_sessions").fetchone()[0], 0
            )

    def test_synonym_investigations_are_routed_to_measured_evidence(self):
        self.login()
        for question, tool in (
            ("Why are crashes rising?", "query_errors"),
            ("Why is the site slow?", "query_performance"),
            ("What release preceded this?", "query_deployments"),
        ):
            status, result = self.request("/api/investigate", {"question": question})
            self.assertEqual(status, 200)
            self.assertNotIn("unsupported", result)
            self.assertIn(tool, json.dumps(result["trace"]))

    def test_webhook_outbox_retries_with_stable_id_and_stops_on_success(self):
        self.login()
        self.request(
            "/api/alerts", {"metric": "errors", "threshold": 1, "minimumSessions": 1}
        )
        settings = {
            "DEUCALINT_WEBHOOKS": json.dumps(
                {
                    "demo": {
                        "url": "https://hooks.example/alerts",
                        "signingSecret": "x" * 32,
                    }
                }
            )
        }
        with patch.dict(os.environ, settings), patch.object(
            s, "metrics", return_value={"errors": 10, "sessions": 25}
        ), patch.object(s, "send_webhook", side_effect=[503, 204]) as send:
            s.evaluate_alerts(10000)
            s.evaluate_alerts(10001)
            s.dispatch_webhooks(10000)
            rows = self.request("/api/deliveries")[1]["deliveries"]
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["status"], "retry")
            s.dispatch_webhooks(11000)
            s.dispatch_webhooks(12000)
            rows = self.request("/api/deliveries")[1]["deliveries"]
            self.assertEqual(rows[0]["status"], "sent")
            self.assertEqual(rows[0]["attempts"], 2)
            self.assertEqual(
                send.call_args_list[0].args[2], send.call_args_list[1].args[2]
            )

    def test_unconfigured_alerts_never_create_or_send_external_delivery(self):
        self.login()
        self.request(
            "/api/alerts", {"metric": "errors", "threshold": 1, "minimumSessions": 1}
        )
        with patch.dict(os.environ, {"DEUCALINT_WEBHOOKS": "{}"}), patch.object(
            s, "metrics", return_value={"errors": 10, "sessions": 25}
        ), patch.object(s, "send_webhook") as send:
            s.evaluate_alerts()
            s.dispatch_webhooks()
            send.assert_not_called()
        self.assertEqual(self.request("/api/deliveries")[1]["deliveries"], [])

    def test_webhook_redirect_is_terminal_and_failures_have_retry_limit(self):
        self.login()
        self.request(
            "/api/alerts", {"metric": "errors", "threshold": 1, "minimumSessions": 1}
        )
        with patch.dict(
            os.environ, {"DEUCALINT_WEBHOOKS": '{"demo":{}}'}
        ), patch.object(s, "metrics", return_value={"errors": 10, "sessions": 25}):
            s.evaluate_alerts(10000)
            with patch.object(s, "send_webhook", return_value=302) as send:
                s.dispatch_webhooks(10000)
                s.dispatch_webhooks(20000)
                send.assert_called_once()
            row = self.request("/api/deliveries")[1]["deliveries"][0]
            self.assertEqual(row["status"], "dead")
            self.request("/api/deliveries", {"id": row["id"]})
            now = time.time()
            with patch.object(s, "send_webhook", side_effect=TimeoutError) as send:
                for index in range(8):
                    s.dispatch_webhooks(now + 7200 * index)
                self.assertEqual(send.call_count, 6)
            row = self.request("/api/deliveries")[1]["deliveries"][0]
            self.assertEqual(row["status"], "dead")
            self.assertEqual(row["lastError"], "Destination unavailable")

    def test_webhook_signature_binds_timestamp_and_exact_body(self):
        config = {"url": "https://hooks.example/receive", "signingSecret": "s" * 32}
        body = '{"id":"one","type":"alert.triggered"}'
        with patch.object(
            s,
            "webhook_destination",
            return_value=(s.urlparse(config["url"]), "8.8.8.8"),
        ), patch.object(
            s.http.client.HTTPSConnection, "request"
        ) as request, patch.object(
            s.http.client.HTTPSConnection, "getresponse"
        ) as response:
            response.return_value.status = 204
            self.assertEqual(s.send_webhook(config, body, "one", 1234), 204)
        sent = request.call_args.kwargs
        expected = s.hmac.new(
            config["signingSecret"].encode(), b"1234." + body.encode(), s.hashlib.sha256
        ).hexdigest()
        self.assertEqual(sent["headers"]["X-DeucalInt-Signature"], "sha256=" + expected)
        self.assertEqual(sent["headers"]["Idempotency-Key"], "one")
        self.assertEqual(sent["body"], body.encode())

    def test_independent_web_vitals_are_not_diluted_by_missing_measurements(self):
        self.login()
        self.request(
            "/v1/batch",
            {
                "projectToken": "pk_demo_deucalint",
                "events": [
                    {
                        **event("web_vital", eid="lcp", typ="performance"),
                        "properties": {"lcp": 3000},
                    },
                    {
                        **event("web_vital", eid="cls", typ="performance"),
                        "properties": {"cls": 0.1},
                    },
                ],
            },
        )
        s.consume_once()
        vitals = self.request("/api/observability")[1]["vitals"]
        self.assertEqual(vitals["lcp"], 3000)
        self.assertEqual(vitals["cls"], 0.1)

    def test_webhook_destinations_reject_private_dns_and_non_allowlisted_hosts(self):
        config = {"url": "https://hooks.example/alerts", "signingSecret": "x" * 32}
        with patch.dict(
            os.environ, {"DEUCALINT_WEBHOOK_ALLOWED_HOSTS": "hooks.example"}
        ):
            for ip in (
                "127.0.0.1",
                "169.254.169.254",
                "10.0.0.1",
                "::1",
                "::ffff:127.0.0.1",
            ):
                with patch.object(
                    s.socket, "getaddrinfo", return_value=[(2, 1, 6, "", (ip, 443))]
                ):
                    with self.assertRaises(ValueError):
                        s.webhook_destination(config)
            for url in (
                "http://hooks.example",
                "https://evil.example",
                "https://hooks.example:8443",
                "https://user:pass@hooks.example",
            ):
                with self.assertRaises(ValueError):
                    s.webhook_destination({**config, "url": url})
            with patch.object(
                s.socket, "getaddrinfo", return_value=[(2, 1, 6, "", ("8.8.8.8", 443))]
            ):
                self.assertEqual(s.webhook_destination(config)[1], "8.8.8.8")

    def test_production_startup_refuses_defaults_and_insecure_cookie(self):
        env = {
            "DEUCALINT_ENV": "production",
            "DEUCALINT_SECURE_COOKIES": "1",
            "DEUCALINT_PUBLIC_URL": "https://analytics.example",
            "DEUCALINT_PASSWORD": "strong-owner-password-123",
            "DEUCALINT_VIEWER_PASSWORD": "strong-viewer-password-123",
            "DEUCALINT_DEMO_TOKEN": "a" * 32,
            "DEUCALINT_SANDBOX_TOKEN": "b" * 32,
        }
        with patch.dict(os.environ, env), patch.object(
            s, "ORIGINS", {"https://analytics.example"}
        ):
            s.validate_startup()
            self.assertIn("; Secure", s.session_cookie("test"))
            with self.assertRaises(ValueError):
                s.validate_stored_credentials()
            with patch.dict(os.environ, {"DEUCALINT_PASSWORD": "deucalint-local"}):
                with self.assertRaises(ValueError):
                    s.validate_startup()
            with patch.dict(os.environ, {"DEUCALINT_SECURE_COOKIES": "0"}):
                with self.assertRaises(ValueError):
                    s.validate_startup()


if __name__ == "__main__":
    unittest.main()
