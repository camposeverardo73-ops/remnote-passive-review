# Developer Release Steps — 0.0.48 RC

This file is for the plugin developer, not ordinary marketplace users.

## A. Existing pre-release account: migration first

Use the separate **migration RC source** on the original Mac once while online. It still contains the old bundled private asset solely so the migration can copy that page into RemNote synced plugin storage while preserving existing source/mask/Rem/Card IDs.

Acceptance before switching to the clean marketplace source:

1. old page still renders;
2. existing masks still align;
3. existing Native Card bindings remain intact;
4. no “旧版页面资源尚未完成迁移” message remains after a reload;
5. no duplicate Rem/Card is created.

Status in this environment: NOT VERIFIED.

## B. Prepare repository metadata

Official RemNote manifest documentation requires a repository URL for JavaScript plugins. Create/confirm the real GitHub repository, then set:

`public/manifest.json -> repoUrl`

Do not use the RemNote template repository as the project URL.

## C. Upgrade the PDF dependency

Before marketplace submission, upgrade `pdfjs-dist` to a fixed version >=4.2.67, update the lockfile and any import paths required by that version, then re-run PNG/JPG/PDF import regression on Mac and iPad.

The current RC already sets `isEvalSupported:false`, but that is defense-in-depth, not a substitute for upgrading a vulnerable dependency.

## D. Add real screenshots

Create `marketplace-screenshots/` with at least five real, privacy-safe screenshots:

1. main review UI;
2. classification UI;
3. mask editor;
4. passive review session;
5. iPad landscape.

Do not use private notes, paths, raw IDs, debug logs, or fabricated screenshots.

## E. Run strict release gate on Mac

From the clean marketplace source directory:

```bash
./scripts/release-gate.sh
```

It must finish with:

`RELEASE GATE PASS`

The script produces/validates `PluginZip.zip`, prints its SHA-256, and rejects common private/development files.

## F. Install the exact production artifact

Test the generated `PluginZip.zip` through RemNote's production ZIP installation path, not localhost.

Run the complete Mac regression, then real iPad and cross-device acceptance.

## G. Publication

Only after all release gates pass should the package be submitted through RemNote's current official marketplace/developer submission channel. Do not treat a locally generated ZIP as “published”.
