# Verification report — current makeover

Verified 2026-09-30 on Windows, Node24, Python3.14, Java21.

| Check | Result |
|---|---|
| Angular AOT + strict templates + SDK build | Passed; 365.96KB initial assets, 96.33KB estimated transfer |
| Python/API/static asset regression | 64 passed |
| SDK unit tests | 7 passed; ESM5754B gzip, loader6040B gzip |
| Chromium UI | 12 scenarios verified |
| WebKit makeover UI | 7 scenarios verified |
| Independent cross-origin SDK capture | Chromium and WebKit passed |
| Firefox | Installed runtime fails launch with Windows spawn UNKNOWN; behavior unverified |
| Java | 9 passed; 2 Docker integration tests skipped |
| Deterministic intent/safe-output/evidence fixtures | 12/12,12/12,6/6 |
| Synthetic anomaly fixture | Precision95.24%, recall100%;60TP,3FP,0FN |

Tests caught and fixed: CSP blocking Angular's inline stylesheet onload; preencoded JSON map bytes being encoded again; and a hidden skip-link regression. Browser checks now require real computed styling and >100 loaded map paths, in addition to functional navigation. The skip link and dialog focus cycle are tested. Map and flow data have keyboard/table alternatives.

The final build passed all five original Chromium scenarios and all seven makeover scenarios. All seven makeover scenarios also passed in WebKit. Separate output directories kept screenshots and traces isolated between runs.

Screenshots are in docs/media. The older walkthrough video predates this makeover. No claim is made for Docker SQL execution, distributed load, external webhook deliverability, live-model quality, hosted CI, deployment, formal accessibility conformance, or production readiness. See DELIVERY_STATUS.md for remaining work.
