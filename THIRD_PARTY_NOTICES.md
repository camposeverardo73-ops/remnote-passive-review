# Third-Party Notices

Mindmap Free Click Review is based on the MIT-licensed RemNote React plugin template and uses the following direct runtime dependencies:

- `@remnote/plugin-sdk` 0.0.46 — ISC License;
- `react` 17.x — MIT License;
- `react-dom` 17.x — MIT License;
- `pdfjs-dist` 3.11.174 — Apache License 2.0 (PDF.js distribution).

The current `pdfjs-dist` pin has a published security advisory and is a release blocker even though the RC disables PDF.js eval during parsing. Marketplace submission requires upgrading and re-running the production build/security gate.

The production bundle is generated from the lockfile. Before marketplace submission, the final `PluginZip.zip` must be accompanied by a dependency-license/security scan from the exact installed lockfile so required transitive notices can be retained.

The original RemNote template MIT copyright notice is retained in `LICENSE`, with a modification copyright notice for this project.
