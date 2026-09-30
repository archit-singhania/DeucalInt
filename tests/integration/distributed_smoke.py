"""Run after starting the distributed Compose profile. Exercises collector → broker → warehouse → API."""

import json, time, urllib.request, uuid


def get_count():
    req = urllib.request.Request(
        "http://127.0.0.1:8081/v1/analytics",
        headers={"Authorization": "Bearer sk_local_deucalint"},
    )
    with urllib.request.urlopen(req, timeout=15) as response:
        return int(json.load(response)["data"][0]["events"])


before = get_count()
eid = str(uuid.uuid4())
event = {
    "eventId": eid,
    "schemaVersion": 1,
    "type": "product",
    "name": "integration_smoke",
    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "anonymousId": eid,
    "sessionId": eid,
    "properties": {"password": "must-not-be-stored"},
}
for _ in range(2):
    req = urllib.request.Request(
        "http://127.0.0.1:8080/v1/batch",
        data=json.dumps(
            {"projectToken": "pk_demo_deucalint", "events": [event]}
        ).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=40) as response:
        assert response.status == 202
deadline = time.time() + 60
while time.time() < deadline:
    if get_count() == before + 1:
        break
    time.sleep(1)
else:
    raise AssertionError("Event did not arrive or duplicate was counted")
time.sleep(3)
assert get_count() == before + 1
print("PASS: durable ingestion, async delivery, deduplicated warehouse query")
