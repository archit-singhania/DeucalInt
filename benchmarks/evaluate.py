"""Reproducible measurements. No claimed distributed throughput."""

import importlib.util, json, random, statistics, time, sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "apps/ai-engine"))
from engine import anomalies, metrics, funnel

spec = importlib.util.spec_from_file_location(
    "local", root / "apps/local-api/server.py"
)
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
rng = random.Random(73)
tp = fp = fn = tn = 0
for trial in range(200):
    series = [
        {"label": str(i), "sessions": 100, "conversion": max(0, rng.gauss(30, 2))}
        for i in range(21)
    ]
    abnormal = trial % 2 == 0
    if abnormal:
        series[-1]["conversion"] = rng.uniform(5, 15)
    detected = any(a["label"] == "20" for a in anomalies(series))
    tp += detected and abnormal
    fp += detected and not abnormal
    fn += not detected and abnormal
    tn += not detected and not abnormal
events = s.synthetic()
times = []
for _ in range(25):
    start = time.perf_counter()
    metrics(events)
    funnel(events)
    times.append((time.perf_counter() - start) * 1000)
precision = tp / (tp + fp) if tp + fp else 0
recall = tp / (tp + fn) if tp + fn else 0
report = {
    "dataset": {"events": len(events), "seed": 29, "days": 35},
    "localPythonMetricsPlusFunnelMs": {
        "runs": len(times),
        "p50": round(statistics.median(times), 2),
        "p95": round(sorted(times)[23], 2),
    },
    "MADSyntheticEvaluation": {
        "series": 200,
        "seed": 73,
        "truePositive": tp,
        "falsePositive": fp,
        "falseNegative": fn,
        "trueNegative": tn,
        "precision": precision,
        "recall": recall,
        "f1": (
            2 * precision * recall / (precision + recall) if precision + recall else 0
        ),
    },
    "limitations": "In-process synthetic evaluation on this machine. Not HTTP ingestion throughput, not a production ML benchmark. No seasonality.",
}
out = root / "docs/benchmarks/local-results.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
