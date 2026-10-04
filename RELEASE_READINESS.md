# RELEASE READINESS

Release candidate: **Mindmap Free Click Review 0.0.48 RC**
Date: 2026-10-04

## 1. Architecture

The formal-release architecture remains the existing RemNote front-end plugin:

RemNote → sandboxed Plugin UI → RemNote Native Rem/Card APIs → plugin synced user metadata → device-local derived StudyIndex cache.

No second scheduler was added. Again/Hard/Good/Easy still call the RemNote Native Card API and verify the result by reading the same card back.

Release-layer additions only:

- per-install plugin data-root bootstrap/migration;
- schema-versioned migration;
- clean fresh-install behavior (no developer sample data);
- production Error Boundary;
- mobile safe-area/responsive hardening;
- privacy/security/release scripts and docs;
- local-only GlobalStudyIndex cache;
- session-only technical audit logs.

## 2. Desktop-only Dependencies

### Original risks removed from runtime

- hard-coded developer KB Rem ID: removed;
- private developer page auto-injection: removed from fresh installs;
- private study media in marketplace source: removed;
- developer absolute paths: none in clean runtime;
- runtime localhost / 127.0.0.1: none;
- direct fs/Electron/child_process: none;
- Window tree parsing / private DB access: none.

### Remaining desktop-only items

Only build tooling (`npm`, webpack, shell release script) is desktop/developer-side. Ordinary users do not need it.

### Unknown platform capability

Real iPad behavior of Pane hosting / file picker / PDF worker remains NOT VERIFIED.

## 3. Localhost Audit

Production runtime: **PASS (static)**.

No localhost / 127.0.0.1 / port 8080 dependency exists in `src/` or `public/`.

Webpack devServer still uses port 8080 only when `NODE_ENV !== production`, which is appropriate for development and is not copied as a running server into the plugin artifact.

## 4. RN API Audit

Official RemNote APIs used for authoritative data/actions include:

- Rem and Card lookup;
- Native Card `updateCardRepetitionStatus(...)`;
- repetition history / next repetition reads;
- Rem creation/move/collapse/open;
- plugin storage Synced/Local/Session;
- widget registration / command / sidebar button;
- Pane opening through the public Window API.

Private DB writes: **none**.
Native mode: **not requested**.
RN internal DOM scraping: **none found**.
Window-tree string parsing: **none found**.

Remaining workaround: plugin-owned technical Rem containers are used to bind manually drawn image masks to Native Cards. They are created through public APIs and are not a second scheduler.

## 5. Storage

### Cross-device authoritative user data (Synced)

- page/source metadata;
- compressed image-page chunks;
- mask geometry;
- mask ↔ Rem/Card mapping;
- Primary Subject and Custom Category relations;
- per-install technical data-root mapping;
- plugin schema version.

### RN native synchronized data

- actual Rems / Native Cards;
- scheduler state;
- repetition history;
- due times.

### Local cache only

`GlobalStudyIndex` is now device-local and rebuildable. It is not the source of truth.

### Session-only diagnostics

Upload/rating/navigation audit records are no longer synced across devices.

Cross-device behavior of the synced plugin data is **NOT VERIFIED on a real Mac+iPad pair**.

## 6. iPad Compatibility

Static/mobile hardening completed:

- manifest enables mobile;
- sandboxed plugin mode;
- no desktop filesystem/Electron APIs;
- browser File/Blob/Canvas import path;
- Pointer Events rather than mouse-only core behavior;
- coarse-pointer minimum target sizes;
- safe-area support;
- dynamic viewport units;
- responsive controls;
- rating buttons remain touch-accessible;
- no core operation requires a keyboard shortcut.

Current official RemNote documentation states that plugins are unavailable offline. The plugin does not claim its own offline runtime.

Status:

- iPad layout static audit: PASS
- iPad browser-size visual simulation: NOT VERIFIED
- iPad real device: NOT VERIFIED
- iPad PDF import: NOT VERIFIED
- iPad background/resume/rotation: NOT VERIFIED

## 7. Cross Device

Required Mac↔iPad acceptance has not been executed here.

- Mac classification → iPad: NOT VERIFIED
- Mac mask → iPad review: NOT VERIFIED
- iPad Good → Mac RN state: NOT VERIFIED
- Mac Good → iPad RN state: NOT VERIFIED

## 8. Performance

Release changes reduce unnecessary persistence/sync pressure:

- GlobalStudyIndex moved from synced storage to device-local cache;
- upload/rating diagnostics moved to session storage;
- PDF.js is dynamically imported only when PDF import is used;
- image object URLs are revoked;
- PDF page/document cleanup added;
- no mass media preload was added.

Not verified in this environment:

- cold start UI-ready time;
- warm start UI-ready time;
- 100-card iPad continuous-session memory curve;
- 10/50/100-page real-device navigation latency;
- iPad object-storage/sync performance for large PDF sets.

## 9. Security

### PASS (static)

- 0 known secrets/API keys/tokens intentionally present;
- 0 runtime external analytics/API/CDN/WebSocket dependencies;
- no native mode;
- no Delete scope;
- no direct DB access;
- no private RN internal React/DOM hooks;
- same-origin-only legacy asset migration;
- Error Boundary prevents a single render exception from exposing a raw crash screen;
- Rating already has an in-flight lock and unknown-outcome lock to prevent repeated submission.

### BLOCKER

`pdfjs-dist 3.11.174` has a published high-severity advisory. The RC disables PDF.js eval during parsing, but marketplace submission is blocked until the dependency and lockfile are upgraded to a fixed release and the PDF import flow is revalidated.

Production `npm audit --omit=dev` is also NOT VERIFIED in this cloud environment.

## 10. Production Build

Configured artifact: `PluginZip.zip`.

Current cloud result: **NOT PRODUCED**.

Reason: clean dependency installation timed out before node_modules were available; therefore the official RemNote validator and production webpack build for 0.0.48 were not run here.

A strict developer release script is included:

`scripts/release-gate.sh`

It performs clean lockfile install, static audit, TypeScript, strict marketplace blockers, production dependency security audit, official validation/build, artifact-content audit, SHA-256, and size reporting.

## 11. Marketplace Package

Metadata prepared:

- name / ID / description / version;
- mobile enabled;
- sandboxed mode;
- permission rationale;
- logo;
- README;
- Privacy statement;
- Release notes;
- License / third-party notices.

Current blockers:

1. real GitHub `repoUrl` missing (official manifest docs require it for JS plugins);
2. vulnerable PDF.js pin must be upgraded;
3. real clean screenshots missing;
4. production `PluginZip.zip` not built and accepted;
5. iPad real-device acceptance missing.

## 12. Tests

- clean release static audit: PASS
- TypeScript/TSX syntax transpile (12 files): PASS
- webpack.config syntax: PASS
- manifest/package/lock JSON parse: PASS
- private study media absent from clean marketplace source: PASS
- private pilot/source IDs absent from clean marketplace runtime: PASS
- production runtime localhost scan: PASS
- desktop fs/Electron/child_process scan: PASS
- private RN DOM/tree hack scan: PASS
- audit logs session-only: PASS
- GlobalStudyIndex local-cache-only: PASS
- image ObjectURL revoke path: PASS (code inspection)
- PDF document cleanup path: PASS (code inspection)
- rating in-flight duplicate lock: PASS (code inspection)
- official RemNote validator: NOT VERIFIED
- full `tsc`: NOT VERIFIED (dependencies unavailable in cloud)
- production webpack build: NOT VERIFIED
- PluginZip install in RemNote production mode: NOT VERIFIED
- Mac 0.0.48 live regression: NOT VERIFIED
- iPad real device: NOT VERIFIED
- cross-device data: NOT VERIFIED
- marketplace install: NOT VERIFIED

## 13. Remaining Blockers

1. Create/confirm a real GitHub repository and place its URL in `manifest.repoUrl`.
2. Upgrade `pdfjs-dist` to >=4.2.67, update imports/lockfile as needed, and pass PDF import regression.
3. Run `scripts/release-gate.sh` on a clean Mac build environment with network access.
4. Install the resulting production `PluginZip.zip` in RemNote (not localhost) and run Mac regression.
5. Run real iPad landscape/portrait/file-import/review/background tests.
6. Run Mac↔iPad data and Native Card rating synchronization tests.
7. Capture five real privacy-safe marketplace screenshots.
8. Confirm RemNote's current official marketplace submission channel at submission time; public official docs checked in this audit do not expose a complete self-service submission workflow.

## 14. Final Decision

# NOT READY

The RC source is substantially cleaner and release-oriented, but the release blockers above prevent an honest `READY FOR MARKETPLACE SUBMISSION` decision.

### Required status matrix

- Desktop Release Build: **FAIL — production artifact not produced in this environment**
- RemNote Production Install: **FAIL — no accepted 0.0.48 PluginZip artifact yet**
- Mac: **NOT VERIFIED for 0.0.48 RC**
- iPad Layout: **NOT VERIFIED on a rendered iPad host (static CSS audit PASS)**
- iPad Real Device: **NOT VERIFIED**
- Cross Device Data: **NOT VERIFIED**
- Marketplace Package: **BLOCKED**
- Marketplace Publication: **BLOCKED**
