# Marketplace Metadata — 0.0.48 RC Draft

- **Name:** Mindmap Free Click Review
- **Plugin ID:** `mindmap_free_click_review`
- **Version:** 0.0.48 RC
- **Author:** Danzhiduo
- **Description:** Passive mind-map review with RemNote Native Card scheduling, classifications, masks, and continuous Due/New study sessions.
- **Mobile:** `enableOnMobile: true`; real iPad acceptance is NOT VERIFIED
- **Native mode:** `requestNative: false`
- **Permission scope:** `All / ReadCreateModify`
- **Permission rationale:** mapped Native Cards can exist anywhere in the user's KB and rating modifies those Native Cards; the plugin also creates plugin-owned technical Rems. Delete permission is not requested.
- **Icon:** `public/logo.svg`
- **Repository:** **BLOCKER** — RemNote's current manifest documentation requires `repoUrl` for JavaScript plugins; no confirmed project GitHub URL is available, so the field is intentionally blank rather than pointing at the template or an invented repository.
- **Project URL:** optional / not supplied
- **Support URL:** optional / not supplied
- **License:** MIT (RemNote template notice retained; 2026 modification copyright added)
- **Privacy:** `PRIVACY.md`
- **Release notes:** `RELEASE_NOTES.md`
- **Third-party notices:** `THIRD_PARTY_NOTICES.md`

## Screenshot gate

Before marketplace submission, capture at least five **real** screenshots using non-private/demo content:

1. main review UI;
2. classification UI;
3. mask editor;
4. passive review session;
5. iPad landscape real-device UI.

Do not submit screenshots containing private study notes, local paths, raw IDs, debug logs, test accounts, or generated/fabricated UI.

## Security gate

`pdfjs-dist` must be upgraded from 3.11.174 to a fixed release >=4.2.67 and the updated PDF import path must pass Mac+iPad regression before marketplace submission.
