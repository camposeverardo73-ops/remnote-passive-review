# RELEASE_AUDIT — Mindmap Free Click Review 0.0.48 RC

Audit date: 2026-10-04
Baseline: 0.0.47
Release target: 0.0.48 RC (not 1.0.0)

## Executive result

The project is a RemNote V1 Front-End Plugin based on the official React template architecture. The business layer remains RemNote-Native-Card-backed; this RC work is limited to release packaging, storage/migration, privacy/security, mobile hardening, and production error containment.

The source is **not yet marketplace-ready** because the strict release gate still has three explicit blockers:

1. `manifest.repoUrl` has no confirmed real GitHub repository URL.
2. `pdfjs-dist` is pinned to 3.11.174, which has a published high-severity advisory; runtime eval is disabled as defense-in-depth, but the dependency must still be upgraded and rebuilt before submission.
3. Five real, privacy-safe marketplace screenshots (including iPad landscape) have not been captured.

Real iPad and Mac↔iPad cross-device acceptance are also NOT VERIFIED.

## 1. Is this a standard RemNote Front-End Plugin?

Yes. It uses the RemNote React plugin template model:

- `declareIndexPlugin(...)` activation entry;
- `WidgetLocation.Pane` for the main UI;
- RemNote Plugin SDK APIs for Rem/Card/storage/widget/window actions;
- `public/manifest.json` manifestVersion 1;
- webpack production build intended to generate `PluginZip.zip`.

## 2. Entry files

- Plugin lifecycle entry: `src/widgets/index.tsx`
- Main application widget: `src/widgets/mindmap_viewer.tsx`
- Main widget location: `WidgetLocation.Pane`

## 3. RemNote Plugin SDK version

`@remnote/plugin-sdk`: **0.0.46** (exact pin).

## 4. package.json

Release version is `0.0.48`.
Runtime dependencies:

- `@remnote/plugin-sdk` 0.0.46
- React / ReactDOM 17.x
- `pdfjs-dist` 3.11.174

A lockfile is present.

## 5. Manifest / metadata

Release manifest:

- id: `mindmap_free_click_review`
- name: `Mindmap Free Click Review`
- version: `{ major: 0, minor: 0, patch: 48 }`
- `enableOnMobile: true`
- `requestNative: false`
- scope: `All / ReadCreateModify`
- no Delete permission
- repoUrl: blank (MARKETPLACE BLOCKER; do not invent a repository)

The old hard-coded private `DescendantsOfId(...)` scope was removed.

## 6. Build pipeline

Development:

`npm run dev` → webpack-dev-server on port 8080.

Production:

`npm run build` → release static audit → RemNote validator → production webpack → `dist/` → `PluginZip.zip`.

Strict marketplace gate:

`scripts/release-gate.sh`

It additionally checks lockfile install, TypeScript, marketplace blockers, production dependency audit, package content, checksum, and size.

## 7. Can the production build run independently?

Architecture: yes, it is designed to be self-contained and does not require localhost at runtime.

Current environment verification: **NOT VERIFIED**. `npm ci` timed out in the cloud environment before dependencies were installed, so the official validator/webpack build for 0.0.48 could not be honestly run here.

## 8. localhost dependency

Production runtime source: none.

`localhost` / port 8080 only exist in webpack's development branch and are not a runtime application dependency.

## 9. 127.0.0.1 dependency

Production runtime: none found.

## 10. Development-server dependency

Production runtime: none found. `webpack-dev-server` is a build/development dependency only.

## 11. Mac filesystem path dependency

Production runtime source: none found.

No `/Users/...`, Downloads path, tmp path, or developer absolute path is present in the clean marketplace source.

## 12. Node.js-only runtime APIs

Production `src/`: none found.

Node APIs are used only by build/release scripts.

## 13. Electron-only runtime APIs

None found.

## 14. Direct desktop filesystem access

None found. Page import uses browser `File`, `Blob`, `ArrayBuffer`, `Canvas`, and RemNote plugin storage.

## 15. shell / child_process

Production runtime: none.
Build tooling uses shell commands only during developer release creation.

## 16. Absolute paths

Clean production runtime: none found.

## 17. Development environment variables

`NODE_ENV` is used only to select development versus production webpack behavior.

## 18. Hard-coded port

Port 8080 exists only inside the non-production webpack devServer branch.

## 19. Debug-only routes / debug UI

No production debug route found. Technical upload/rating/navigation diagnostics were changed to session-only storage. Reveal performance console profiling was removed from release UI.

## 20. iOS / iPad risk inventory

### Mobile-safe / web-platform-oriented

- RemNote SDK Card/Rem/storage APIs
- File input / File / Blob / ArrayBuffer
- Canvas image conversion
- Pointer Events
- ResizeObserver
- crypto.randomUUID / crypto.subtle when available
- responsive CSS / safe-area env variables
- Native Card rating through official RemNote SDK

### Desktop-only runtime dependencies

None identified in application source.

### Unknown / requires real-device verification

- `WidgetLocation.Pane` + `openWidgetInPane` behavior on current iPad RemNote
- iOS WebView file picker behavior for PNG/JPEG/WebP/PDF
- PDF.js worker/chunk behavior in RemNote iOS WebView
- synced plugin-storage capacity/performance for many compressed page images
- landscape/portrait transitions under the real RemNote mobile host
- background/resume and lock/unlock behavior under iOS process suspension
- Mac↔iPad plugin-synced data convergence

## Storage classification

### A. RemNote native data

- Rem objects used as plugin-owned technical containers
- Native Cards bound to masks
- Native Card scheduler/repetitionHistory/nextRepetitionTime

### B. Plugin persistent synced storage

- source library metadata
- compressed page image chunks
- manual mask metadata and Rem/Card mappings
- Primary Subject / Custom Category relations
- plugin data-root mapping
- plugin data schema version

### C. Device-local cache

- `GlobalStudyIndex` derived cache (`storage.getLocal/setLocal`)

It is rebuildable from synced page/mask/card data and RN Native Cards. It is not authoritative user data.

### D. Session-only data

- return Rem ID / pane bookkeeping
- primary-subject repair audit
- upload diagnostic events
- rating verification diagnostic snapshot
- navigation timing trace
- current React review-session state while the widget remains mounted

### Desktop-local-only authoritative user data

None intentionally retained in the clean RC.

## Stable ID audit

- `fileId`: generated once at import and persisted
- `page/sourceId`: derived from stable imported file ID + page number and persisted
- `maskId`: generated once and persisted
- `cardId`: RemNote Native Card ID
- `categoryId`: system stable IDs or generated custom UUID persisted in synced storage

No device filesystem path is used as a primary ID.

## Network audit

Core runtime has no third-party API, analytics, CDN, WebSocket, remote fonts, or remote image dependency.

The only `fetch()` path is pre-release legacy asset migration. It is now restricted to same-origin / inline data/blob URLs; external legacy URLs are blocked rather than requested.

## Permission audit

Sandboxed mode remains enabled (`requestNative:false`).

`All / ReadCreateModify` is broad but currently necessary because mapped Native Cards may live anywhere in the user's KB and rating modifies their scheduler state; the plugin also creates its own technical Rems. Delete permission is not requested.

## Private/undocumented API audit

No direct RemNote database access, internal React tree access, RN DOM class scraping, `getCurrentWindowTree`, `getURL/setURL`, or desktop-private API is present in release runtime source.

## Privacy/source-package audit

The clean marketplace source excludes:

- private study images/PDFs;
- private region JSON;
- old Pilot inspector/provision source;
- backups/logs/node_modules/build artifacts;
- private local paths.

Existing pre-release users receive a separate migration RC so their old bundled page can be moved into RemNote synced plugin storage without changing existing source/mask/Rem/Card IDs.

## Error containment

A production React Error Boundary was added. A component crash shows a generic retry surface instead of raw stack/IDs/JSON.

## Mobile UI hardening

- `100dvh/100dvw` support
- iOS safe-area top/bottom/left/right
- coarse-pointer minimum touch sizes
- responsive toolbar/status/rating dock
- no core action depends only on keyboard or hover
- existing color/interaction hierarchy preserved

## Memory cleanup

- image Object URLs are revoked
- PDF page cleanup is requested after render
- PDF document `destroy()` is called in `finally`
- event listeners / ResizeObserver already unregister on effect cleanup
- PDF import disables PDF.js eval via `isEvalSupported:false`

## Security blocker

`pdfjs-dist 3.11.174` remains pinned in the lockfile and has a published high-severity advisory. `isEvalSupported:false` reduces exposure, but a marketplace submission must still update the dependency to a fixed version (>=4.2.67), update the lockfile, pass TypeScript/webpack/mobile PDF import, and pass the production dependency audit.
