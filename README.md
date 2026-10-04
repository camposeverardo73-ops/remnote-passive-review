# Mindmap Free Click Review

Mindmap Free Click Review is a RemNote front-end plugin for studying image/PDF pages with manual masks while keeping RemNote Native Cards and RemNote scheduling as the source of truth.

## Install

When a marketplace build is approved, install it from **RemNote → Settings → Plugins**, enable it, then open **Mindmap Free Review** from the sidebar or command menu.

This release candidate can also be installed from its production `PluginZip.zip` through RemNote's Developer plugin ZIP installer for pre-release testing. Normal users do **not** need Terminal, npm, localhost, or a computer-side server.

## Start studying

1. Open the plugin.
2. Use **加入页面** to add PNG/JPG/WebP/PDF material.
3. Use **遮挡编辑** to draw the regions you want to recall.
4. Open **分类** to assign the current page to a subject or custom collection.
5. Tap **到期** or **新卡** to start a continuous review session.
6. Tap a mask to reveal/hide the answer, then rate with **重来 / 困难 / 良好 / 简单**.

Ratings are submitted to the bound RemNote Native Card. The plugin does not implement a second scheduler.

## Study controls

- **到期** — next Due card in the current study scope.
- **新卡** — next New card in the current study scope.
- **完成** — cards completed in the current session (view-only).
- **剩余** — next unfinished item in the current study scope.
- **自由背诵** — reveal/hide masks without writing scheduling data.
- **遮挡编辑** — create or adjust masks.
- **分类** — choose the current study scope and page classifications.

## iPad / mobile

The release candidate enables RemNote mobile support and includes responsive layout, safe-area handling, pointer/touch controls, and touch-sized rating buttons. Core actions do not require keyboard shortcuts.

**Important:** RemNote currently does not run plugins while offline. If the device is offline, reconnect before opening the plugin. The real iPad device acceptance test for this RC is still required before marketplace submission.

## Data and sync

User classifications, source metadata/assets, masks, and card mappings are stored with RemNote synced plugin storage and RemNote-native objects. The GlobalStudyIndex is a rebuildable device-local cache, not authoritative user data. Session-only UI/diagnostic state is not treated as authoritative study data.

Existing pre-release Rem/Card IDs are preserved during migration; the release does not recreate Native Cards merely to migrate data.

## Privacy

The plugin does not send notes, images, PDFs, card content, or analytics to third-party servers. See `PRIVACY.md` for details.

## Troubleshooting

If one plugin feature fails, the release Error Boundary shows a retry screen instead of exposing a React stack trace. Your original RemNote notes and Native Cards are not deleted by the retry action.

For pre-release bug reports, include the RemNote version, device type, and the action that triggered the issue. Do not include private study material unless necessary.
