import importlib.util, sys, tempfile, unittest, json, time, threading, urllib.request, urllib.error, http.cookiejar
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "server", ROOT / "apps/local-api/server.py"
)
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
from engine import (
    funnel,
    retention,
    validate_ast,
    matches,
    experiments,
    anomalies,
    investigate,
)


def event(name="page_view", offset=0, sid="session", eid=None, typ="product"):
    return {
        "eventId": eid or name + str(offset) + sid,
        "schemaVersion": 1,
        "type": typ,
        "name": name,
        "timestamp": s.iso(time.time() - 60 + offset),
        "anonymousId": "visitor",
        "sessionId": sid,
        "properties": {},
    }


class AnalyticsTests(unittest.TestCase):
    def test_ordered_funnel_rejects_wrong_order(self):
        es = [event("a"), event("c", 1), event("b", 2)]
        self.assertEqual(
            [x["count"] for x in funnel(es, ["a", "b", "c"])["steps"]], [1, 1, 0]
        )

    def test_unordered_funnel(self):
        self.assertEqual(
            funnel(
                [event("a"), event("c", 1), event("b", 2)],
                ["a", "b", "c"],
                ordered=False,
            )["steps"][-1]["count"],
            1,
        )

    def test_funnel_time_window_and_multiple_attempts(self):
        es = [
            event("a"),
            event("b", 10),
            event("c", 40),
            event("a", 42),
            event("b", 43),
            event("c", 44),
        ]
        r = funnel(es, ["a", "b", "c"], window=5)
        self.assertEqual([x["count"] for x in r["steps"]], [1, 1, 1])
        self.assertEqual(r["medianSeconds"], 2)

    def test_no_double_count_per_session(self):
        es = [event("a"), event("b", 1), event("a", 2), event("b", 3)]
        self.assertEqual(funnel(es, ["a", "b"])["steps"][1]["count"], 1)

    def test_no_cross_session_conversion(self):
        self.assertEqual(
            funnel([event("a"), event("b", 1, "other")], ["a", "b"])["steps"][1][
                "count"
            ],
            0,
        )

    def test_segment_allowlist(self):
        for ast in [
            {"dimension": "1=1; DROP TABLE", "operator": "eq", "value": "x"},
            {"and": [{"sql": "x"}]},
            {"dimension": "browser", "operator": "contains", "value": "x"},
        ]:
            with self.assertRaises(ValueError):
                validate_ast(ast)

    def test_segments_match_nested_conjunctions(self):
        ast = validate_ast(
            {"and": [{"dimension": "name", "operator": "in", "value": ["a", "b"]}]}
        )
        self.assertTrue(matches(event("a"), ast))
        self.assertFalse(matches(event("c"), ast))

    def test_retention_has_unmatured_cells(self):
        r = retention([event()], time.time())
        self.assertEqual(r[0]["values"][0], 100)
        self.assertIsNone(r[0]["values"][-1])

    def test_anomaly_drop(self):
        series = [
            {"conversion": 30 + i % 3, "sessions": 100, "label": str(i)}
            for i in range(14)
        ] + [{"conversion": 5, "sessions": 100, "label": "drop"}]
        self.assertEqual(anomalies(series)[-1]["label"], "drop")

    def test_small_sample_suppresses_anomaly(self):
        series = [
            {"conversion": 30, "sessions": 100, "label": str(i)} for i in range(14)
        ] + [{"conversion": 5, "sessions": 2, "label": "small"}]
        self.assertEqual(anomalies(series), [])

    def test_experiment_intervals_and_pvalue(self):
        es = []
        for i in range(200):
            e = event("pricing_redesign", sid=str(i), typ="experiment")
            e["anonymousId"] = str(i)
            e["properties"] = {"variant": "A" if i < 100 else "B"}
            es.append(e)
            if i % 2 == 0:
                es.append(
                    {
                        **e,
                        "name": "purchase_completed",
                        "type": "product",
                        "eventId": "p" + str(i),
                    }
                )
        r = experiments(es)
        self.assertEqual(r["pValue"], 1)
        self.assertLess(r["variants"][0]["interval"][0], 50)
        self.assertGreater(r["variants"][0]["interval"][1], 50)

    def test_evidence_empty_dataset(self):
        r = investigate([], time.time() - 86400, time.time())
        self.assertFalse(r["sufficientData"])
        self.assertIn("not proven causes", r["caveat"])

    def test_experiment_excludes_cross_exposure_and_prior_purchases(self):
        a = event("pricing_redesign", 10, typ="experiment")
        a["properties"] = {"variant": "A"}
        prior = event("purchase_completed", 0)
        self.assertEqual(experiments([prior, a])["variants"][0]["conversions"], 0)
        b = {**a, "eventId": "second", "properties": {"variant": "B"}}
        result = experiments([a, b, event("purchase_completed", 20)])
        self.assertEqual(result["excludedVisitors"], 1)
        self.assertEqual(result["variants"], [])

    def test_unordered_funnel_does_not_reuse_one_event(self):
        result = funnel([event("a")], ["a", "a"], ordered=False)
        self.assertEqual(result["steps"][-1]["count"], 0)


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        s.DB = Path(self.tmp.name) / "test.db"
        s.init_db(False)
        s.RATES.clear()
        s.LOGIN.clear()
        self.http = s.ThreadingHTTPServer(("127.0.0.1", 0), s.Handler)
        self.http.daemon_threads = True
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.base = "http://127.0.0.1:" + str(self.http.server_port)
        self.client = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
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
            with (client or self.client).open(req, timeout=3) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.load(e)
            finally:
                e.close()

    def login(self, role="owner"):
        self.assertEqual(
            self.request(
                "/api/login",
                {
                    "role": role,
                    "password": (
                        "deucalint-local" if role == "owner" else "deucalint-viewer"
                    ),
                },
            )[0],
            200,
        )

    def batch(self, es, token="pk_demo_deucalint"):
        return self.request("/v1/batch", {"projectToken": token, "events": es})

    def test_project_membership_isolation_and_revocation(self):
        self.login()
        status, project = self.request("/api/projects", {"name": "Private product"})
        self.assertEqual(status, 201)
        query = "?project=" + project["id"]
        status, _ = self.request(
            "/api/members" + query,
            {
                "username": "test_analyst",
                "password": "test-secret-1234",
                "role": "analyst",
            },
        )
        self.assertEqual(status, 200)
        member = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )
        self.assertEqual(
            self.request(
                "/api/login",
                {"username": "test_analyst", "password": "test-secret-1234"},
                client=member,
            )[0],
            200,
        )
        self.assertEqual(
            self.request("/api/overview?project=demo", client=member)[0], 403
        )
        self.assertEqual(self.request("/api/overview" + query, client=member)[0], 200)
        self.assertEqual(self.request("/api/token" + query, {}, client=member)[0], 403)
        self.assertEqual(
            self.request(
                "/api/reports" + query,
                {"name": "Report", "segment": {"and": []}},
                client=member,
            )[0],
            200,
        )
        self.assertEqual(
            self.request("/api/members" + query, {"id": "owner"}, method="DELETE")[0],
            400,
        )
        self.assertEqual(
            self.request(
                "/api/members" + query, {"id": "test_analyst"}, method="DELETE"
            )[0],
            200,
        )
        self.assertEqual(self.request("/api/overview" + query, client=member)[0], 403)

    def test_comparison_and_investigation_history(self):
        self.login()
        status, data = self.request("/api/overview")
        self.assertEqual(status, 200)
        self.assertEqual(len(data["series"]), len(data["previousSeries"]))
        self.assertEqual(
            self.request(
                "/api/investigate", {"question": "Why did conversion change?"}
            )[0],
            200,
        )
        status, history = self.request("/api/investigations")
        self.assertEqual(status, 200)
        self.assertEqual(len(history), 1)
        self.assertIn("trace", history[0]["result"])

    def test_alert_cooldown_sample_and_acknowledgement(self):
        from unittest.mock import patch

        self.login()
        status, rules = self.request(
            "/api/alerts",
            {
                "metric": "errors",
                "threshold": 1,
                "minimumSessions": 20,
                "cooldownMinutes": 60,
            },
        )
        self.assertEqual(status, 200)
        with patch.object(s, "metrics", return_value={"errors": 10, "sessions": 2}):
            s.evaluate_alerts(10000)
        self.assertEqual(self.request("/api/notifications")[1], [])
        with patch.object(s, "metrics", return_value={"errors": 10, "sessions": 25}):
            s.evaluate_alerts(10000)
            s.evaluate_alerts(10001)
        rows = self.request("/api/notifications")[1]
        self.assertEqual(len(rows), 1)
        self.assertEqual(
            self.request("/api/notifications", {"id": rows[0]["id"]})[1][0][
                "acknowledged"
            ],
            True,
        )
        with patch.object(s, "metrics", return_value={"errors": 10, "sessions": 25}):
            s.evaluate_alerts(14000)
        self.assertEqual(len(self.request("/api/notifications")[1]), 2)
        self.assertEqual(self.request("/api/notifications?project=sandbox")[1], [])

    def test_durable_accept_then_processing(self):
        status, r = self.batch([event()])
        self.assertEqual(status, 202)
        self.assertEqual(r["accepted"], 1)
        self.assertEqual(s.read_events("demo"), [])
        s.consume_once()
        self.assertEqual(len(s.read_events("demo")), 1)

    def test_duplicate_before_and_after_processing(self):
        e = event()
        self.batch([e])
        self.assertEqual(self.batch([e])[1]["duplicates"], 1)
        s.consume_once()
        self.assertEqual(self.batch([e])[1]["duplicates"], 1)
        self.assertEqual(len(s.read_events("demo")), 1)

    def test_atomic_batch_validation(self):
        bad = event()
        bad["schemaVersion"] = 2
        self.assertEqual(self.batch([event(), bad])[0], 400)
        s.consume_once()
        self.assertEqual(s.read_events("demo"), [])

    def test_tenant_spoofing_denied(self):
        e = event()
        e["projectId"] = "sandbox"
        self.assertEqual(self.batch([e])[0], 400)

    def test_invalid_token_and_origin(self):
        self.assertEqual(self.batch([event()], "pk_wrong")[0], 403)
        self.assertEqual(
            self.request(
                "/v1/batch",
                {"projectToken": "pk_demo_deucalint", "events": [event()]},
                headers={"Origin": "https://evil.example"},
            )[0],
            403,
        )

    def test_privacy_scrubs_nested_credentials_and_urls(self):
        e = event()
        e["properties"] = {
            "nested": {"password": "secret", "email": "user@example.com"},
            "note": "Bearer abc123",
        }
        e["page"] = {"url": "https://shop.test/?token=abc", "path": "/checkout?email=x"}
        self.batch([e])
        s.consume_once()
        stored = json.dumps(s.read_events("demo"))
        self.assertNotIn("secret", stored)
        self.assertNotIn("user@example.com", stored)
        self.assertNotIn("abc", stored)

    def test_replay_strips_arbitrary_dom_fields(self):
        e = event(typ="replay")
        e["properties"] = {
            "nodes": [
                {
                    "tag": "script",
                    "html": "<script>alert(1)</script>",
                    "text": "private",
                    "width": 300,
                }
            ]
        }
        self.batch([e])
        s.consume_once()
        stored = s.read_events("demo")[0]
        self.assertEqual(stored["properties"]["nodes"][0]["tag"], "div")
        self.assertNotIn("html", json.dumps(stored))

    def test_project_queries_and_auth(self):
        self.assertEqual(self.request("/api/overview")[0], 401)
        self.login()
        self.batch([event()], "pk_sandbox_deucalint")
        s.consume_once()
        self.assertEqual(
            self.request("/api/overview?project=demo")[1]["metrics"]["events"], 0
        )
        self.assertEqual(
            self.request("/api/overview?project=sandbox")[1]["metrics"]["events"], 1
        )
        self.assertEqual(self.request("/api/overview?project=unowned")[0], 403)

    def test_viewer_cannot_mutate(self):
        self.login("viewer")
        self.assertEqual(self.request("/api/settings", {"retention": 7})[0], 403)
        self.assertEqual(self.request("/api/settings")[0], 200)

    def test_deletion_blocks_pending_and_redelivery(self):
        self.login()
        e = event()
        self.batch([e])
        self.request(
            "/api/lifecycle", {"kind": "visitor", "value": "visitor"}, "DELETE"
        )
        s.consume_once()
        self.batch([{**e, "eventId": "retry"}])
        s.consume_once()
        self.assertEqual(s.read_events("demo"), [])

    def test_token_rotation_invalidates_previous(self):
        self.login()
        token = self.request("/api/token", {})[1]["token"]
        self.assertEqual(self.batch([event()])[0], 403)
        self.assertEqual(self.batch([event()], token)[0], 202)

    def test_poison_message_moves_to_deadletter(self):
        with s.connect() as c:
            c.execute(
                "INSERT INTO inbox(project,event_id,body,created) VALUES('demo','bad','not json',?)",
                (time.time(),),
            )
        s.consume_once()
        with s.connect() as c:
            self.assertEqual(
                c.execute("SELECT status FROM inbox").fetchone()[0], "deadletter"
            )

    def test_late_and_out_of_order_events(self):
        a, b = event("a"), event("b", 10)
        self.batch([b, a])
        s.consume_once()
        self.assertEqual([x["name"] for x in s.read_events("demo")], ["a", "b"])

    def test_rate_limit(self):
        for _ in range(120):
            self.assertFalse(s.Handler.limited(self, "test", 120))
        self.assertTrue(s.Handler.limited(self, "test", 120))

    def test_alert_persistence_and_evaluation(self):
        self.login()
        self.batch([event(typ="error")])
        s.consume_once()
        r = self.request(
            "/api/alerts", {"metric": "errors", "threshold": 0, "minimumSessions": 1}
        )
        self.assertTrue(r[1][0]["triggered"])
        self.assertEqual(len(self.request("/api/alerts")[1]), 1)

    def test_unknown_question_is_not_fabricated(self):
        self.login()
        r = self.request("/api/investigate", {"question": "Tell me the weather"})
        self.assertTrue(r[1]["unsupported"])


if __name__ == "__main__":
    unittest.main()
