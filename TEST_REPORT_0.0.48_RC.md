# TEST REPORT — 0.0.48 RC

Date: 2026-10-04

## Static tests completed in this environment

| Test | Result |
|---|---|
| Release static audit | PASS (repo URL warning only) |
| TS/TSX syntax transpile | PASS — 12 files / 0 syntax errors |
| webpack config JS syntax | PASS |
| package.json parse | PASS |
| package-lock.json parse | PASS |
| manifest.json parse | PASS |
| Clean-source private-data scan | PASS |
| Runtime localhost/127.0.0.1 scan | PASS |
| Runtime fs/Electron/child_process scan | PASS |
| RN internal DOM/window-tree hack scan | PASS |
| Synced/local/session storage separation audit | PASS |
| Rating in-flight/unknown-outcome lock code audit | PASS |
| Object URL revoke code audit | PASS |
| PDF destroy/cleanup code audit | PASS |
| External legacy migration fetch blocked | PASS |
| Marketplace strict gate | FAIL (expected blockers: repoUrl, PDF.js security floor, screenshots) |

## Build tests

### Clean dependency install

Attempted in the cloud environment. It timed out before dependencies were available.

Result: **NOT VERIFIED / environment blocked**.

### Full TypeScript (`tsc`)

Not run because project dependencies were not installed.

Result: **NOT VERIFIED**.

### RemNote official validator

Not run because project dependencies were not installed.

Result: **NOT VERIFIED**.

### Production webpack + PluginZip.zip

Not produced in this environment.

Result: **NOT VERIFIED**.

## Real application tests

| Test | Result |
|---|---|
| Mac 0.0.48 fresh install | NOT VERIFIED |
| Mac 0.0.47 → 0.0.48 migration | NOT VERIFIED |
| Production ZIP install (non-localhost) | NOT VERIFIED |
| iPad install/enable/open | NOT VERIFIED |
| iPad landscape | NOT VERIFIED |
| iPad portrait | NOT VERIFIED |
| iPad rotation | NOT VERIFIED |
| iPad Files picker image import | NOT VERIFIED |
| iPad PDF import | NOT VERIFIED |
| Tap Reveal/Re-hide | NOT VERIFIED |
| Again/Hard/Good/Easy | NOT VERIFIED |
| Continuous Due/New auto-next | NOT VERIFIED |
| Background/resume/lock | NOT VERIFIED |
| Mac classification → iPad | NOT VERIFIED |
| iPad Good → Mac RN state | NOT VERIFIED |
| Mac Good → iPad RN state | NOT VERIFIED |
| 100-card memory run | NOT VERIFIED |

No unexecuted test is reported as PASS.
