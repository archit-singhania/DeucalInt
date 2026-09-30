# Verification report

Last verified locally: **2026-09-30**, Windows, Node 24, Python 3.14, Java 21 and Maven 3.9.11.

| Check | Observed result |
|---|---|
| Angular AOT production compilation + strict templates | Passed |
| Python analytics, HTTP pipeline, privacy, authorization, lifecycle and FastAPI tests | **37 passed** |
| Browser/Node SDK privacy, delivery retry and bundle-budget tests | **3 passed** |
| Java collector contracts and SDK retry delivery | **4 passed** |
| Testcontainers Kafka integration | **1 skipped: no Docker runtime** |
| Playwright Chromium | **5 passed**: overview/evidence; analytics routes; SDK-to-live delivery; mobile overflow/layout; command palette/theme/segments/comparison |
| Java Maven reactor packaging | Passed for platform and Java SDK |
| Prettier and Black | Passed |
| Deployment/API YAML syntax | Parsed successfully; syntax validation is not deployment validation |
| npm dependency audit | Zero reported vulnerabilities after compatible formatter dependency updates |
| Desktop and mobile visual inspection | Reviewed screenshots; mobile banner layout adjusted |
| Walkthrough recording | Saved to `docs/media/walkthrough.webm` |

## Measured scope

The current browser SDK is **5,153 bytes gzip**, under its 12 KiB budget. Angular AOT now produces **309.03 KB total initial assets**, approximately **85.02 KB estimated transfer**. This replaces the previous JIT build. Route splitting remains optional future work. Python and browser coverage now includes membership isolation/revocation and new UI controls. Java results below are from the preceding verification; Java sources were not changed by this upgrade.

`docs/benchmarks/local-results.json` contains actual in-process analytics timing and a reproducible 200-series synthetic MAD-detector evaluation. Its precision/recall results reflect deliberately simple labeled synthetic signals. They are not evidence of real-world forecasting quality or distributed system throughput.

## Not executed or not claimed

- Docker Compose services, ClickHouse migrations/materialized views, broker-to-warehouse delivery, outage recovery, k6 network load, monitoring containers and Kubernetes deployment.
- A live Ollama model. The deterministic planner and service authorization were tested with FastAPI TestClient; model-generated planning is unverified.
- GitHub-hosted CI, registry publishing, public hosting, production traffic, multi-region behavior or production security certification.

The full roadmap remains partially implemented. See `PHASES.md` for every remaining item. Skipped or unavailable checks are not counted as passes.

## Reproduce

```sh
npm ci
npm run check
python -m venv .venv
# Activate .venv, or call its Python executable directly.
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -p 'test_*.py' -v
npx playwright install chromium
npm run test:e2e
mvn verify
npm run format:check
python -m black --check apps tests benchmarks
python benchmarks/evaluate.py
```

The plain system-Python test run intentionally skips FastAPI tests unless their optional dependencies are installed. The recorded count of 34 used the project virtual environment and ran those tests.
