import type { RNPlugin } from '@remnote/plugin-sdk';
import type { MindmapSource } from './mindmap-source-store';

export const PLUGIN_DATA_ROOT_KEY = 'mindmap-plugin-data-root-v1';
const LEGACY_PILOT_STORAGE_KEY = 'pilot-b2-plugin-owned-bindings-v1';

export type PluginDataRootState = {
  schema_version: 1;
  root_rem_id: string | null;
  page_containers: Record<string, string>;
  migrated_from_legacy?: boolean;
  updated_at: string;
};

function emptyState(): PluginDataRootState {
  return {
    schema_version: 1,
    root_rem_id: null,
    page_containers: {},
    updated_at: new Date(0).toISOString(),
  };
}

async function readState(plugin: RNPlugin) {
  const stored = await plugin.storage.getSynced<PluginDataRootState>(PLUGIN_DATA_ROOT_KEY);
  if (!stored || stored.schema_version !== 1) return emptyState();
  return {
    ...stored,
    page_containers: stored.page_containers ?? {},
  };
}

async function saveState(plugin: RNPlugin, state: PluginDataRootState) {
  const next = { ...state, updated_at: new Date().toISOString() };
  await plugin.storage.setSynced(PLUGIN_DATA_ROOT_KEY, next);
  return next;
}

async function findReadableRem(plugin: RNPlugin, remId: string | null | undefined) {
  if (!remId) return null;
  try {
    return (await plugin.rem.findOne(remId)) ?? null;
  } catch {
    return null;
  }
}

async function readLegacyBindingState(plugin: RNPlugin) {
  try {
    return await plugin.storage.getSynced<any>(LEGACY_PILOT_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Resolve the plugin-owned data root without hard-coding any user's Rem ID.
 * Existing installs migrate from their synced legacy binding record when it is
 * still readable. Fresh installs create one plugin-owned top-level Rem.
 */
export async function ensurePluginDataRoot(plugin: RNPlugin) {
  let state = await readState(plugin);
  const storedRoot = await findReadableRem(plugin, state.root_rem_id);
  if (storedRoot) return { state, root: storedRoot };

  const legacy = await readLegacyBindingState(plugin);
  const legacyRootId = typeof legacy?.data_document_rem_id === 'string'
    ? legacy.data_document_rem_id
    : null;
  const legacyRoot = await findReadableRem(plugin, legacyRootId);
  if (legacyRoot) {
    state = await saveState(plugin, {
      ...state,
      root_rem_id: legacyRoot._id,
      migrated_from_legacy: true,
    });
    return { state, root: legacyRoot };
  }

  const created = await plugin.rem.createRem();
  if (!created) throw new Error('无法创建插件数据容器。');
  await created.setText(['Mindmap Review Data']);
  try {
    await created.collapse(undefined);
  } catch {
    // Cosmetic only. A failure to collapse must not block the data root.
  }
  state = await saveState(plugin, { ...state, root_rem_id: created._id });
  return { state, root: created };
}

async function inferContainerFromRegions(
  plugin: RNPlugin,
  document: { regions: readonly { rem_id: string | null }[] } | null | undefined,
) {
  if (!document) return null;
  for (const region of document.regions) {
    if (!region.rem_id) continue;
    const rem = await findReadableRem(plugin, region.rem_id);
    if (!rem?.parent) continue;
    const parent = await findReadableRem(plugin, rem.parent);
    if (parent) return parent;
  }
  return null;
}

/**
 * Returns an existing page container if one can be recovered without creating
 * anything. Used by destructive-looking cleanup paths so they never create new
 * Rems just to verify ownership.
 */
export async function findExistingPluginPageContainer(
  plugin: RNPlugin,
  source: MindmapSource,
  document?: { regions: readonly { rem_id: string | null }[] } | null,
) {
  const state = await readState(plugin);
  const mapped = await findReadableRem(plugin, state.page_containers[source.source_id]);
  if (mapped) return mapped;

  const inferred = await inferContainerFromRegions(plugin, document);
  if (inferred) {
    await saveState(plugin, {
      ...state,
      page_containers: { ...state.page_containers, [source.source_id]: inferred._id },
    });
    return inferred;
  }

  const legacy = await readLegacyBindingState(plugin);
  const legacyPageId = typeof legacy?.page_container_rem_id === 'string'
    ? legacy.page_container_rem_id
    : null;
  const legacyPage = await findReadableRem(plugin, legacyPageId);
  if (legacyPage) {
    await saveState(plugin, {
      ...state,
      page_containers: { ...state.page_containers, [source.source_id]: legacyPage._id },
      migrated_from_legacy: true,
    });
    return legacyPage;
  }

  return null;
}

/**
 * Resolve/create the technical Rem container for one source page. Existing
 * Region->Rem/Card mappings are never recreated; their current parent is used
 * as the authoritative migration source when available.
 */
export async function ensurePluginPageContainer(
  plugin: RNPlugin,
  source: MindmapSource,
  document?: { regions: readonly { rem_id: string | null }[] } | null,
) {
  const existing = await findExistingPluginPageContainer(plugin, source, document);
  if (existing) return existing;

  const { state, root } = await ensurePluginDataRoot(plugin);
  const created = await plugin.rem.createRem();
  if (!created) throw new Error('无法创建页面数据容器。');
  await created.setParent(root);
  await created.setText([source.title || 'Mindmap Page']);
  try {
    await created.collapse(undefined);
  } catch {
    // Cosmetic only.
  }
  await saveState(plugin, {
    ...state,
    page_containers: { ...state.page_containers, [source.source_id]: created._id },
  });
  return created;
}
