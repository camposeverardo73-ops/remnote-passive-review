# Privacy Statement — Mindmap Free Click Review

## Data the plugin reads

The plugin reads only the RemNote/plugin data needed to provide its study workflow, including:

- RemNote Native Cards bound to plugin masks;
- card scheduling fields and repetition history required to classify Due/New/completed state;
- Rem objects used as plugin-owned technical containers;
- plugin-synced source assets, mask metadata, classification relations, and Rem/Card mappings.

## Data the plugin writes

The plugin writes:

- RemNote Native Card ratings only after the user explicitly taps Again/Hard/Good/Easy;
- plugin-owned technical Rems used to bind manually created mask regions to Native Cards;
- persistent user data through RemNote `storage.setSynced`;
- the derived GlobalStudyIndex only to device-local plugin storage (`storage.setLocal`);
- upload/rating/navigation diagnostics only to session storage.

The plugin does not rewrite the user's original note text merely to classify or mask a page.

## Network and third parties

The core plugin has no third-party API, analytics, tracking, advertising, remote font, or CDN dependency. Learning content is not uploaded by this plugin to a third-party server.

RemNote itself may sync RemNote data and synced plugin storage as part of the user's RemNote account. That is RemNote platform synchronization, not a separate service operated by this plugin.

The pre-release migration path only reads an old bundled asset when it resolves to the plugin's own origin (or an inline data/blob URL). External migration URLs are rejected rather than fetched. Public marketplace builds do not ship the developer's private migration asset.

## PDF safety

PDF import runs inside the plugin using PDF.js. The current RC disables PDF.js JavaScript/eval support during document parsing (`isEvalSupported: false`). The pinned `pdfjs-dist` dependency is still scheduled for upgrade to a non-vulnerable release before marketplace submission; see the release readiness report.

## Offline behavior

RemNote's current platform documentation states that plugins are unavailable while offline. The plugin does not pretend to provide an independent offline runtime or scheduler.

## Analytics

No analytics or telemetry is collected by this plugin.
