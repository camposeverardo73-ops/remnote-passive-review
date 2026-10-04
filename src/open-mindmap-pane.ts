import type { RNPlugin } from '@remnote/plugin-sdk';

export const MINDMAP_PANE_STORAGE_KEY = 'mindmap-review-pane-ids-v3';
export const MINDMAP_RETURN_REM_SESSION_KEY = 'mindmap-return-rem-id-v3';

let openPromise: Promise<string | null> | null = null;
let lastOpenAt = 0;

/**
 * Host-safe Pane opening.
 *
 * Important integration rule:
 * - WidgetLocation.Pane is retained because it is the accepted full-screen host.
 * - The plugin never parses/serializes the host window tree.
 * - The plugin never feeds a returned `widget~...` pane id back into
 *   WindowNamespace APIs. This removes the plugin-side path that could turn a
 *   widget pane representation into a window-layout parse input.
 * - Native Rem navigation is handled from the Rem object itself in the viewer.
 */
export async function openOrFocusMindmapPane(plugin: RNPlugin) {
  const now = Date.now();
  if (openPromise) return openPromise;
  if (now - lastOpenAt < 500) return null;
  lastOpenAt = now;

  openPromise = (async () => {
    try {
      try {
        const focusedRem = await plugin.focus.getFocusedRem();
        if (focusedRem?._id) {
          await plugin.storage.setSession(MINDMAP_RETURN_REM_SESSION_KEY, focusedRem._id);
        }
      } catch {
        // Return target is optional; never inspect the host window tree as fallback.
      }

      const paneIds = await plugin.window.openWidgetInPane('mindmap_viewer');
      if (!paneIds.length) {
        await plugin.app.toast('Mindmap 打开失败：RemNote 未创建 Pane');
        return null;
      }

      // Store only for diagnostics. Do not refocus/replay widget pane ids.
      await plugin.storage.setSession(MINDMAP_PANE_STORAGE_KEY, paneIds);
      return paneIds[paneIds.length - 1];
    } catch (error) {
      console.error('[Mindmap][PANE_OPEN_FAIL]', {
        error_source: 'openOrFocusMindmapPane',
        caller: 'plugin.window.openWidgetInPane',
        expected_format: 'RemNote-created pane ids',
        fail_reason: error instanceof Error ? error.message : String(error ?? 'unknown error'),
      });
      try {
        await plugin.app.toast('Mindmap 打开失败，请重试');
      } catch {
        // Preserve the original failure if toast delivery also fails.
      }
      return null;
    } finally {
      openPromise = null;
    }
  })();

  return openPromise;
}
