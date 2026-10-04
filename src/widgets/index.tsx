import {
  declareIndexPlugin,
  type ReactRNPlugin,
  WidgetLocation,
} from '@remnote/plugin-sdk';
import { MINDMAP_PANE_STORAGE_KEY, openOrFocusMindmapPane } from '../open-mindmap-pane';
import '../style.css';
import '../index.css';

async function safeUnregister(plugin: ReactRNPlugin, fileName: string, location: WidgetLocation) {
  try {
    await plugin.app.unregisterWidget(fileName, location);
  } catch {
    // Missing historical registrations are expected on a fresh install.
  }
}

async function onActivate(plugin: ReactRNPlugin) {
  // 0.0.36 removes the entire FloatingWidget host path. Clear old registrations
  // first so a force-reload cannot leave a stale half-height floating surface.
  for (const location of [
    WidgetLocation.FloatingWidget,
    WidgetLocation.DocumentBelowTitle,
    WidgetLocation.PaneHeader,
    WidgetLocation.TopBar,
    WidgetLocation.Pane,
  ]) {
    await safeUnregister(plugin, 'mindmap_viewer', location);
    await safeUnregister(plugin, 'mindmap_return', location);
  }

  // Stale floating IDs/pane IDs from older builds are bookkeeping only. No
  // Rem/Card/scheduler data is touched.
  await plugin.storage.setSession('mindmap-floating-widget-id-v1', null);
  await plugin.storage.setSession(MINDMAP_PANE_STORAGE_KEY, []);

  // A Pane is the only host surface in 0.0.36. Unlike FloatingWidget it is sized
  // by RemNote's workspace itself, so the viewer's 100vw/100vh fills the entire
  // pane without exposing the RN footer underneath.
  await plugin.app.registerWidget('mindmap_viewer', WidgetLocation.Pane, {
    widgetTabTitle: 'Mindmap Review',
    widgetTabIcon: '🧠',
    dontOpenByDefaultInTabLocation: false,
  });

  await plugin.app.registerCommand({
    id: 'open-mindmap-free-click-review',
    name: 'Mindmap Free Review',
    description: 'Open or focus the full-workspace Mindmap review pane.',
    keywords: 'mindmap daily review free click reveal fsrs 思维导图 今日复习 自由点击',
    keyboardShortcut: 'mod+shift+m',
    action: async () => {
      await openOrFocusMindmapPane(plugin);
    },
  });

  await plugin.app.registerSidebarButton({
    id: 'open-mindmap-free-click-review-sidebar',
    name: '🧠 Mindmap Free Review',
    description: 'Open or focus the full-workspace Mindmap review pane.',
    action: async () => {
      await openOrFocusMindmapPane(plugin);
    },
  });
}

async function onDeactivate(plugin: ReactRNPlugin) {
  // Do not touch RemNote window trees. Only clear this plugin's pane cache.
  await plugin.storage.setSession(MINDMAP_PANE_STORAGE_KEY, []);
}

declareIndexPlugin(onActivate, onDeactivate);
