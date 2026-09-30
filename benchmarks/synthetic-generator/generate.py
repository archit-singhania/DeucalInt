"""Generate traffic through the public collector; never insert directly into the database."""

import argparse, json, uuid, time, urllib.request

p = argparse.ArgumentParser()
p.add_argument("--endpoint", default="http://127.0.0.1:8100")
p.add_argument("--token", default="pk_sandbox_deucalint")
p.add_argument("--sessions", type=int, default=50)
p.add_argument("--regression", action="store_true")
a = p.parse_args()
start = time.perf_counter()
accepted = 0
for i in range(a.sessions):
    sid = str(uuid.uuid4())
    events = []
    for n, name in enumerate(
        [
            "page_view",
            "product_viewed",
            "checkout_started",
            "PaymentFormError" if a.regression else "purchase_completed",
        ]
    ):
        events.append(
            {
                "eventId": str(uuid.uuid4()),
                "schemaVersion": 1,
                "type": (
                    "page"
                    if n == 0
                    else "error" if name == "PaymentFormError" else "product"
                ),
                "name": name,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "anonymousId": sid,
                "sessionId": sid,
                "context": {
                    "browser": "Safari" if a.regression else "Chrome",
                    "release": (
                        "synthetic-regression" if a.regression else "synthetic-stable"
                    ),
                },
                "properties": {},
            }
        )
    req = urllib.request.Request(
        a.endpoint + "/v1/batch",
        data=json.dumps({"projectToken": a.token, "events": events}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        accepted += json.load(r)["accepted"]
    time.sleep(0.55)
elapsed = time.perf_counter() - start
print(
    json.dumps(
        {
            "sessions": a.sessions,
            "eventsAccepted": accepted,
            "seconds": round(elapsed, 3),
            "eventsPerSecond": round(accepted / elapsed, 2),
            "note": "Paced generator, not maximum throughput benchmark",
        },
        indent=2,
    )
)
