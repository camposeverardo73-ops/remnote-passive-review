import type { QueueInteractionScore, RNPlugin } from '@remnote/plugin-sdk';
import { readManualRegionDocument, type ManualRegion } from './manual-region-store';
import type { MindmapSource } from './mindmap-source-store';
import { sourceFileId as sourceFileIdFromStore } from './mindmap-source-store';
import { categoryMatchesLocation, type StudyLibrary } from './study-library';
import { classifyNativeCard, type NativeCardState } from './review-state';

export const GLOBAL_STUDY_INDEX_KEY = 'mindmap-global-study-index-v1';

export type StudyReviewItem = {
  key: string;
  sourceId: string;
  sourceTitle: string;
  sourceOrder: number;
  fileId: string;
  fileName: string;
  pageNumber: number;
  regionId: string;
  regionLabel: string;
  regionOrder: number;
  cardId: string | null;
  remId: string | null;
  state: NativeCardState;
  nextRepetitionTime: number | null;
  lastRepetitionTime: number | null;
  repetitionHistoryLength: number | null;
  reviewedToday: boolean;
  latestReviewTime: number | null;
  latestScore: QueueInteractionScore | null;
};

export type StudyReviewCounts = {
  due: number;
  newCards: number;
  completed: number;
  remaining: number;
  unknown: number;
};

type StoredGlobalStudyIndex = {
  schema_version: 1;
  revision: number;
  updated_at: string;
  source_signature: string;
  items: StudyReviewItem[];
};

function normalizeUnixTime(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value < 10_000_000_000 ? value * 1000 : value;
}

function localDayKey(value: number | Date) {
  const date = value instanceof Date ? value : new Date(normalizeUnixTime(value) ?? value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function historySummary(card: {
  repetitionHistory?: readonly { date?: number | Date; score?: QueueInteractionScore }[];
  lastRepetitionTime?: number;
}) {
  const today = localDayKey(Date.now());
  const entries = Array.isArray(card.repetitionHistory) ? card.repetitionHistory : [];
  let reviewedToday = false;
  let latestReviewTime: number | null = null;
  let latestScore: QueueInteractionScore | null = null;
  for (const entry of entries) {
    if (entry?.date === undefined) continue;
    const time = entry.date instanceof Date ? entry.date.getTime() : normalizeUnixTime(entry.date);
    if (time === null) continue;
    if (localDayKey(time) === today) reviewedToday = true;
    if (latestReviewTime === null || time > latestReviewTime) {
      latestReviewTime = time;
      latestScore = typeof entry.score === 'number' ? entry.score : null;
    }
  }
  if (latestReviewTime === null && typeof card.lastRepetitionTime === 'number') {
    latestReviewTime = normalizeUnixTime(card.lastRepetitionTime);
    if (latestReviewTime !== null && localDayKey(latestReviewTime) === today) reviewedToday = true;
  }
  return { reviewedToday, latestReviewTime, latestScore };
}

function emptyItem(source: MindmapSource, sourceOrder: number, region: ManualRegion, regionOrder: number): StudyReviewItem {
  const hasBinding = region.binding_status === 'BOUND' && !!region.card_id && !!region.rem_id;
  return {
    key: `${source.source_id}:${region.region_id}`,
    sourceId: source.source_id,
    sourceTitle: source.title,
    sourceOrder,
    fileId: sourceFileIdFromStore(source),
    fileName: source.file_name || source.title,
    pageNumber: source.page_number ?? 1,
    regionId: region.region_id,
    regionLabel: region.label || `区域 ${regionOrder + 1}`,
    regionOrder,
    cardId: region.card_id,
    remId: region.rem_id,
    state: hasBinding ? 'UNKNOWN' : 'UNMAPPED',
    nextRepetitionTime: null,
    lastRepetitionTime: null,
    repetitionHistoryLength: null,
    reviewedToday: false,
    latestReviewTime: null,
    latestScore: null,
  };
}

function applyNativeCard(item: StudyReviewItem, card: any): StudyReviewItem {
  if (!card || !item.cardId || !item.remId || card._id !== item.cardId || card.remId !== item.remId) {
    return { ...item, state: item.cardId && item.remId ? 'UNKNOWN' : 'UNMAPPED' };
  }
  const summary = historySummary(card);
  return {
    ...item,
    state: classifyNativeCard(card, true),
    nextRepetitionTime: normalizeUnixTime(card.nextRepetitionTime),
    lastRepetitionTime: normalizeUnixTime(card.lastRepetitionTime),
    repetitionHistoryLength: Array.isArray(card.repetitionHistory) ? card.repetitionHistory.length : null,
    reviewedToday: summary.reviewedToday,
    latestReviewTime: summary.latestReviewTime,
    latestScore: summary.latestScore,
  };
}

export function sourceSignature(sources: readonly MindmapSource[]) {
  return sources
    .map((source) => [
      source.source_id,
      source.file_id ?? '',
      source.page_number ?? 1,
      source.source_hash ?? '',
      source.created_at,
    ].join(':'))
    .join('|');
}

export function refreshTemporalStudyStates(items: readonly StudyReviewItem[], now = Date.now()) {
  return items.map((item) => {
    if ((item.state !== 'DUE' && item.state !== 'NOT_DUE') || item.nextRepetitionTime === null) return item;
    const dueNow = item.nextRepetitionTime <= now;
    const nextState: NativeCardState = dueNow ? 'DUE' : 'NOT_DUE';
    return nextState === item.state ? item : { ...item, state: nextState };
  });
}

export async function readPersistedStudyReviewIndex(plugin: RNPlugin, sources: readonly MindmapSource[]) {
  const stored = await plugin.storage.getLocal<StoredGlobalStudyIndex>(GLOBAL_STUDY_INDEX_KEY);
  if (!stored || stored.schema_version !== 1 || stored.source_signature !== sourceSignature(sources) || !Array.isArray(stored.items)) {
    return null;
  }
  // This is not a local scheduler: it only projects the real RN nextRepetitionTime
  // across the current clock so a cached NOT_DUE card becomes DUE when its RN due
  // timestamp passes. The scheduler value itself is never modified here.
  return refreshTemporalStudyStates(stored.items);
}

export async function savePersistedStudyReviewIndex(plugin: RNPlugin, sources: readonly MindmapSource[], items: readonly StudyReviewItem[]) {
  const previous = await plugin.storage.getLocal<StoredGlobalStudyIndex>(GLOBAL_STUDY_INDEX_KEY);
  const stored: StoredGlobalStudyIndex = {
    schema_version: 1,
    revision: (previous?.revision ?? 0) + 1,
    updated_at: new Date().toISOString(),
    source_signature: sourceSignature(sources),
    items: [...items],
  };
  await plugin.storage.setLocal(GLOBAL_STUDY_INDEX_KEY, stored);
  return stored;
}

export async function buildStudyReviewIndex(plugin: RNPlugin, sources: readonly MindmapSource[]): Promise<StudyReviewItem[]> {
  const pageResults = await Promise.all(
    sources.map(async (source, sourceOrder) => {
      try {
        const document = await readManualRegionDocument(plugin, source);
        return document.regions
          .filter((region) => region.active)
          .map((region, regionOrder) => ({ source, sourceOrder, region, regionOrder }));
      } catch {
        return [];
      }
    }),
  );
  const flat = pageResults.flat();
  const cardCache = new Map<string, any>();
  await Promise.all(
    Array.from(new Set(flat.map(({ region }) => region.card_id).filter((id): id is string => !!id))).map(async (cardId) => {
      try {
        cardCache.set(cardId, await plugin.card.findOne(cardId));
      } catch {
        cardCache.set(cardId, undefined);
      }
    }),
  );
  return flat.map(({ source, sourceOrder, region, regionOrder }) => {
    const item = emptyItem(source, sourceOrder, region, regionOrder);
    if (region.binding_status !== 'BOUND' || !region.card_id || !region.rem_id) return item;
    return applyNativeCard(item, cardCache.get(region.card_id));
  });
}

export async function buildSourceStudyReviewIndex(plugin: RNPlugin, source: MindmapSource, sourceOrder = 0) {
  return buildStudyReviewIndex(plugin, [{ ...source }]).then((items) => items.map((item) => ({ ...item, sourceOrder })));
}

export async function refreshStudyReviewItem(plugin: RNPlugin, item: StudyReviewItem) {
  if (!item.cardId || !item.remId) return item;
  try {
    const card = await plugin.card.findOne(item.cardId);
    return applyNativeCard(item, card);
  } catch {
    return { ...item, state: 'UNKNOWN' as NativeCardState };
  }
}

export function mergeSourceStudyItems(
  current: readonly StudyReviewItem[],
  sourceId: string,
  replacement: readonly StudyReviewItem[],
) {
  const kept = current.filter((item) => item.sourceId !== sourceId);
  return [...kept, ...replacement].sort((a, b) => a.sourceOrder - b.sourceOrder || a.regionOrder - b.regionOrder);
}

export function replaceStudyItem(current: readonly StudyReviewItem[], replacement: StudyReviewItem) {
  return current.map((item) => item.key === replacement.key ? replacement : item);
}

export function filterStudyItemsForCategory(
  items: readonly StudyReviewItem[],
  library: StudyLibrary | null,
  categoryId: string,
) {
  return items.filter((item) => categoryMatchesLocation(library, categoryId, {
    fileId: item.fileId,
    pageId: item.sourceId,
    cardId: item.cardId,
    maskId: item.regionId,
  }));
}

export function filterStudyReviewQueue(items: readonly StudyReviewItem[], filter: 'REMAINING' | 'DUE' | 'NEW' | 'COMPLETED') {
  return items
    .filter((item) => {
      if (filter === 'DUE') return item.state === 'DUE';
      if (filter === 'NEW') return item.state === 'NEW';
      if (filter === 'COMPLETED') return item.reviewedToday;
      return item.state === 'DUE' || item.state === 'NEW';
    })
    .sort((left, right) => {
      if (filter === 'COMPLETED') return (right.latestReviewTime ?? 0) - (left.latestReviewTime ?? 0);
      if (left.state === 'DUE' && right.state === 'NEW') return -1;
      if (left.state === 'NEW' && right.state === 'DUE') return 1;
      if (left.state === 'DUE' && right.state === 'DUE') {
        return (left.nextRepetitionTime ?? 0) - (right.nextRepetitionTime ?? 0);
      }
      if (left.sourceOrder !== right.sourceOrder) return left.sourceOrder - right.sourceOrder;
      return left.regionOrder - right.regionOrder;
    });
}

export function countStudyReviewItems(items: readonly StudyReviewItem[]): StudyReviewCounts {
  const due = items.filter((item) => item.state === 'DUE').length;
  const newCards = items.filter((item) => item.state === 'NEW').length;
  const completed = items.filter((item) => item.reviewedToday).length;
  const unknown = items.filter((item) => item.state === 'UNKNOWN' || item.state === 'UNMAPPED').length;
  return { due, newCards, completed, remaining: due + newCards, unknown };
}
