import type { RNPlugin } from '@remnote/plugin-sdk';
import { ensurePluginPageContainer, findExistingPluginPageContainer } from './plugin-data-root';
import type { MindmapSource } from './mindmap-source-store';

export const LEGACY_MANUAL_REGION_STORAGE_KEY = 'manual-mask-regions-v1';
export const PREVIOUS_MANUAL_REGION_STORAGE_KEY = 'manual-mask-regions-v2';
export const MANUAL_REGION_STORAGE_PREFIX = 'manual-mask-regions-v3:';
export const MANUAL_REGION_BUILD_ID = 'pane-native-review-reset-20261003.9';

export type ManualRegionStatus =
  | 'PLANNED'
  | 'CREATE_REQUESTED'
  | 'REM_CREATED'
  | 'BOUND'
  | 'RESULT_UNKNOWN';

export type ManualRegion = {
  region_id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rem_id: string | null;
  card_id: string | null;
  active: boolean;
  binding_status: ManualRegionStatus;
  source_id: string;
  source_identity: string;
  owner: 'mindmap_free_click_review';
  owner_version: 3;
  source: 'manual';
};

export type ManualRegionDocument = {
  schema_version: 3;
  build_id: typeof MANUAL_REGION_BUILD_ID;
  source_id: string;
  source_identity: string;
  updated_at: string;
  regions: ManualRegion[];
};

export type ManualRegionDraft = Pick<
  ManualRegion,
  'region_id' | 'label' | 'x' | 'y' | 'width' | 'height'
>;

export type ManualRegionBindingResult = {
  document: ManualRegionDocument;
  errors: Record<string, string>;
};

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

function storageKey(sourceId: string) {
  return `${MANUAL_REGION_STORAGE_PREFIX}${sourceId}`;
}

function sourceIdentity(source: MindmapSource) {
  return `mindmap-source:${source.source_id}|${source.title}`;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function normalizeManualRegion(region: ManualRegionDraft): ManualRegionDraft {
  const x = clamp01(region.x);
  const y = clamp01(region.y);
  const width = Math.min(clamp01(region.width), 1 - x);
  const height = Math.min(clamp01(region.height), 1 - y);
  return {
    ...region,
    label: region.label.trim(),
    x,
    y,
    width,
    height,
  };
}

function assertValidRegion(region: ManualRegionDraft) {
  const values = [region.x, region.y, region.width, region.height];
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error(`${region.region_id}: 遮挡坐标必须是 0～1。`);
  }
  if (region.width < 0.005 || region.height < 0.005) {
    throw new Error(`${region.region_id}: 遮挡区域太小。`);
  }
  if (region.x + region.width > 1 || region.y + region.height > 1) {
    throw new Error(`${region.region_id}: 遮挡区域超出原图。`);
  }
}

function emptyDocument(source: MindmapSource): ManualRegionDocument {
  return {
    schema_version: 3,
    build_id: MANUAL_REGION_BUILD_ID,
    source_id: source.source_id,
    source_identity: sourceIdentity(source),
    updated_at: new Date(0).toISOString(),
    regions: [],
  };
}

export async function readManualRegionDocument(
  plugin: RNPlugin,
  source: MindmapSource,
): Promise<ManualRegionDocument> {
  const key = storageKey(source.source_id);
  const stored = await plugin.storage.getSynced<ManualRegionDocument>(key);
  if (stored) {
    if (
      stored.schema_version !== 3 ||
      stored.source_id !== source.source_id ||
      !Array.isArray(stored.regions)
    ) {
      throw new Error('手动遮挡同步数据版本或来源不匹配；未覆盖现有数据。');
    }
    return stored;
  }

  // One-time, non-destructive migration for the built-in pilot source only.
  if (source.kind === 'builtin') {
    const previous = await plugin.storage.getSynced<any>(PREVIOUS_MANUAL_REGION_STORAGE_KEY);
    if (previous?.schema_version === 2 && Array.isArray(previous.regions)) {
      const migrated: ManualRegionDocument = {
        schema_version: 3,
        build_id: MANUAL_REGION_BUILD_ID,
        source_id: source.source_id,
        source_identity: sourceIdentity(source),
        updated_at: new Date().toISOString(),
        regions: previous.regions.map((region: any) => ({
          ...region,
          source_id: source.source_id,
          source_identity: sourceIdentity(source),
          owner_version: 3,
          source: 'manual',
        })),
      };
      await plugin.storage.setSynced(key, migrated);
      return migrated;
    }
  }

  return emptyDocument(source);
}

async function writeManualRegionDocument(
  plugin: RNPlugin,
  document: ManualRegionDocument,
) {
  document.updated_at = new Date().toISOString();
  await plugin.storage.setSynced(storageKey(document.source_id), document);
}

async function validateBinding(plugin: RNPlugin, region: ManualRegion) {
  if (!region.rem_id || !region.card_id) return false;
  const [rem, card] = await Promise.all([
    plugin.rem.findOne(region.rem_id),
    plugin.card.findOne(region.card_id),
  ]);
  return !!rem && !!card && card.remId === rem._id;
}

function regionDisplayName(region: ManualRegion, index?: number) {
  return region.label || `区域 ${typeof index === 'number' ? index + 1 : region.region_id.slice(-6)}`;
}

async function waitForSingleCard(rem: any) {
  let cards = await rem.getCards();
  for (let attempt = 0; attempt < 8 && cards.filter((card: any) => card.remId === rem._id).length !== 1; attempt += 1) {
    await sleep(250);
    cards = await rem.getCards();
  }
  return cards.filter((card: any) => card.remId === rem._id);
}

async function ensureNativeCard(
  plugin: RNPlugin,
  document: ManualRegionDocument,
  region: ManualRegion,
  source: MindmapSource,
  index: number,
) {
  if (region.binding_status === 'BOUND' && (await validateBinding(plugin, region))) {
    const ownedRem = region.rem_id ? await plugin.rem.findOne(region.rem_id) : undefined;
    if (!ownedRem) throw new Error(`${regionDisplayName(region, index)}：已绑定 Rem 无法读取。`);
    const shortLabel = regionDisplayName(region, index);
    await ownedRem.setText([shortLabel]);
    await ownedRem.setBackText(['原图中回忆后评分']);
    return;
  }

  // Safe recovery: if a Rem ID exists, reuse it instead of creating another object.
  let rem = region.rem_id ? await plugin.rem.findOne(region.rem_id) : undefined;
  if (region.binding_status === 'BOUND' && !rem) {
    region.binding_status = 'RESULT_UNKNOWN';
    await writeManualRegionDocument(plugin, document);
    throw new Error(`${regionDisplayName(region, index)}：原绑定对象不可读；未自动重建。`);
  }
  if (region.binding_status === 'RESULT_UNKNOWN') {
    if (!region.rem_id || !rem) {
      throw new Error(`${regionDisplayName(region, index)}：上次创建结果不明确；为防重复未自动重建。`);
    }
    region.card_id = null;
    region.binding_status = 'REM_CREATED';
    await writeManualRegionDocument(plugin, document);
  }
  if (region.binding_status === 'CREATE_REQUESTED' && !region.rem_id) {
    region.binding_status = 'RESULT_UNKNOWN';
    await writeManualRegionDocument(plugin, document);
    throw new Error(`${regionDisplayName(region, index)}：创建请求结果不明确；为防重复未自动重建。`);
  }

  const page = await ensurePluginPageContainer(plugin, source, document);

  if (region.rem_id && !rem) {
    region.binding_status = 'RESULT_UNKNOWN';
    await writeManualRegionDocument(plugin, document);
    throw new Error(`${regionDisplayName(region, index)}：已记录 Rem 无法读取；未自动重建。`);
  }

  if (!rem) {
    region.binding_status = 'CREATE_REQUESTED';
    await writeManualRegionDocument(plugin, document);
    try {
      rem = await plugin.rem.createRem();
    } catch (caught) {
      region.binding_status = 'RESULT_UNKNOWN';
      await writeManualRegionDocument(plugin, document);
      throw caught;
    }
    if (!rem) {
      region.binding_status = 'RESULT_UNKNOWN';
      await writeManualRegionDocument(plugin, document);
      throw new Error(`${regionDisplayName(region, index)}：createRem() 返回空结果。`);
    }
    region.rem_id = rem._id;
    region.binding_status = 'REM_CREATED';
    await writeManualRegionDocument(plugin, document);

  }

  if (rem.parent !== page._id) {
    await rem.setParent(page);
    const moved = await plugin.rem.findOne(rem._id);
    if (!moved || moved.parent !== page._id) {
      region.binding_status = 'RESULT_UNKNOWN';
      await writeManualRegionDocument(plugin, document);
      throw new Error(`${regionDisplayName(region, index)}：无法确认数据容器父级。`);
    }
    rem = moved;
  }

  const shortLabel = regionDisplayName(region, index);
  await rem.setText([shortLabel]);
  await rem.setBackText(['原图中回忆后评分']);
  await rem.setPracticeDirection('forward');
  await rem.setEnablePractice(true);

  const matchingCards = await waitForSingleCard(rem);
  if (matchingCards.length !== 1) {
    region.binding_status = 'REM_CREATED';
    region.card_id = null;
    await writeManualRegionDocument(plugin, document);
    throw new Error(`${shortLabel}：原生卡尚未生成，可稍后点“修复绑定”重试。`);
  }
  region.card_id = matchingCards[0]._id;
  if (!(await validateBinding(plugin, region))) {
    region.binding_status = 'REM_CREATED';
    region.card_id = null;
    await writeManualRegionDocument(plugin, document);
    throw new Error(`${shortLabel}：原生卡回读暂未确认，可稍后重试。`);
  }
  region.binding_status = 'BOUND';
  await writeManualRegionDocument(plugin, document);
}

export async function collapseTechnicalCardContainer(plugin: RNPlugin, source?: MindmapSource) {
  if (!source) return false;
  try {
    const document = await readManualRegionDocument(plugin, source);
    const page = await findExistingPluginPageContainer(plugin, source, document);
    if (!page) return false;
    await page.collapse(undefined);
    return true;
  } catch {
    return false;
  }
}

export async function detachManualRegionCardBindings(
  plugin: RNPlugin,
  source: MindmapSource,
): Promise<ManualRegionDocument> {
  await plugin.app.waitForInitialSync();
  const document = await readManualRegionDocument(plugin, source);

  // True plugin-side detach: remove BOTH stored Region -> Rem and Region -> Card
  // identifiers. The underlying Rem / Native Card objects are intentionally left
  // untouched, so FSRS history is not deleted or rewritten. Rebinding is only
  // performed later by the explicit Repair Binding action.
  for (const region of document.regions) {
    if (!region.active) continue;
    region.card_id = null;
    region.rem_id = null;
    region.binding_status = 'PLANNED';
  }

  await writeManualRegionDocument(plugin, document);
  return document;
}

export type ClearManualRegionsResult = {
  document: ManualRegionDocument;
  clearedRegions: number;
  disabledPracticeRems: number;
  warnings: string[];
};

/**
 * Clear the plugin's occlusion definitions and bindings for one source.
 *
 * This is intentionally stronger than detachManualRegionCardBindings():
 * - all saved Region rectangles are removed from the plugin document;
 * - the old plugin-owned Rems are disabled for practice so their Native Cards
 *   stop participating in RN's global study queue;
 * - the Rems, Cards, repetition history and FSRS data are NOT deleted.
 *
 * Only Rems verified to live under this plugin's scoped data container are
 * modified. Anything outside the owned container is left untouched and
 * reported as a warning.
 */
export async function clearManualRegionsAndBindings(
  plugin: RNPlugin,
  source: MindmapSource,
): Promise<ClearManualRegionsResult> {
  await plugin.app.waitForInitialSync();
  const document = await readManualRegionDocument(plugin, source);
  const active = document.regions.filter((region) => region.active);
  const ownedPage = await findExistingPluginPageContainer(plugin, source, document);
  const ownedParentId = ownedPage?._id ?? null;
  const warnings: string[] = [];
  let disabledPracticeRems = 0;

  for (const region of active) {
    try {
      let remId = region.rem_id;
      if (!remId && region.card_id) {
        const card = await plugin.card.findOne(region.card_id);
        remId = card?.remId ?? null;
      }
      if (!remId) {
        warnings.push(`${regionDisplayName(region)}：旧 rem_id/card_id 已缺失，无法安全定位旧 RN 卡；仅清除插件遮挡与映射。`);
        continue;
      }
      const rem = await plugin.rem.findOne(remId);
      if (!rem) {
        warnings.push(`${regionDisplayName(region)}：旧 Rem 已不可读，未修改 RN。`);
        continue;
      }
      if (!ownedParentId || rem.parent !== ownedParentId) {
        warnings.push(`${regionDisplayName(region)}：旧 Rem 不在插件数据容器内，未修改 RN。`);
        continue;
      }
      await rem.setEnablePractice(false);
      disabledPracticeRems += 1;
    } catch (caught) {
      warnings.push(
        `${regionDisplayName(region)}：停用旧卡失败：${
          caught instanceof Error ? caught.message : String(caught)
        }`,
      );
    }
  }

  const clearedRegions = active.length;
  document.regions = [];
  await writeManualRegionDocument(plugin, document);
  return { document, clearedRegions, disabledPracticeRems, warnings };
}

export async function repairManualRegionBindings(
  plugin: RNPlugin,
  source: MindmapSource,
  regionIds?: readonly string[],
): Promise<ManualRegionBindingResult> {
  await plugin.app.waitForInitialSync();
  const document = await readManualRegionDocument(plugin, source);
  const targetIds = regionIds ? new Set(regionIds) : null;
  const errors: Record<string, string> = {};
  const active = document.regions.filter(
    (region) => region.active && (!targetIds || targetIds.has(region.region_id)),
  );

  for (const region of active) {
    const index = document.regions.findIndex((item) => item.region_id === region.region_id);
    try {
      await ensureNativeCard(plugin, document, region, source, index);
    } catch (caught) {
      errors[region.region_id] = caught instanceof Error ? caught.message : String(caught);
    }
  }
  await writeManualRegionDocument(plugin, document);
  return { document, errors };
}

export async function saveManualRegions(
  plugin: RNPlugin,
  source: MindmapSource,
  drafts: ManualRegionDraft[],
): Promise<ManualRegionBindingResult> {
  await plugin.app.waitForInitialSync();
  const normalized = drafts.map(normalizeManualRegion);
  normalized.forEach(assertValidRegion);
  if (new Set(normalized.map((region) => region.region_id)).size !== normalized.length) {
    throw new Error('发现重复 region_id；未保存。');
  }

  const document = await readManualRegionDocument(plugin, source);
  const existingById = new Map(document.regions.map((region) => [region.region_id, region]));
  const retainedIds = new Set(normalized.map((region) => region.region_id));

  for (const existing of document.regions) {
    if (existing.active && !retainedIds.has(existing.region_id)) existing.active = false;
  }

  for (const draft of normalized) {
    const existing = existingById.get(draft.region_id);
    if (existing) {
      Object.assign(existing, draft, {
        active: true,
        source_id: source.source_id,
        source_identity: sourceIdentity(source),
      });
    } else {
      document.regions.push({
        ...draft,
        rem_id: null,
        card_id: null,
        active: true,
        binding_status: 'PLANNED',
        source_id: source.source_id,
        source_identity: sourceIdentity(source),
        owner: 'mindmap_free_click_review',
        owner_version: 3,
        source: 'manual',
      });
    }
  }
  await writeManualRegionDocument(plugin, document);
  return repairManualRegionBindings(
    plugin,
    source,
    document.regions.filter((item) => item.active).map((item) => item.region_id),
  );
}
