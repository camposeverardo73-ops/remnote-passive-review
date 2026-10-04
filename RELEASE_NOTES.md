# Release Notes — 0.0.48 RC

0.0.48 is a release-candidate hardening pass. It does **not** add a new scheduler or redesign the established review workflow.

## Release-layer changes

- preserves RemNote Native Card scheduling and the existing review UI;
- removes the hard-coded developer Knowledge Base root from release permissions/data-root creation;
- creates/reuses a per-install plugin data root while preserving existing Rem/Card mappings;
- adds schema-versioned, non-destructive pre-release migration;
- prevents fresh installs from auto-injecting developer/private study material;
- provides a clean marketplace source with private pilot media and old inspector/provision code removed;
- updates manifest version/mobile/sandbox metadata to the current RemNote manifest format;
- adds a production React Error Boundary;
- adds iPad safe-area, dynamic viewport, coarse-pointer touch targets and compact touch-landscape hardening;
- moves derived GlobalStudyIndex from synced storage to device-local cache;
- moves upload/rating/navigation diagnostics to session-only storage;
- restricts legacy asset migration fetches to same-origin/inline resources;
- adds PDF page/document cleanup and disables PDF.js eval during parsing;
- keeps localhost/dev-server behavior restricted to development builds;
- adds strict release/marketplace gate scripts and release documentation.

## Known release blockers

- real iPad installation/full interaction suite: NOT VERIFIED;
- Mac ↔ iPad cross-device data test: NOT VERIFIED;
- production `PluginZip.zip` for 0.0.48: NOT PRODUCED in the cloud environment;
- real GitHub `repoUrl`: missing;
- `pdfjs-dist 3.11.174`: known high-severity security advisory; must upgrade to >=4.2.67 and revalidate PDF import;
- real privacy-safe marketplace screenshots: missing;
- marketplace submission/review: NOT VERIFIED.

This RC must not be labeled 1.0.0 or READY FOR MARKETPLACE SUBMISSION until all release gates pass.
