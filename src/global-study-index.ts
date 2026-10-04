import type { StudyLibrary } from './study-library';
import { categoryMatchesLocation } from './study-library';
import type { StudyReviewItem } from './study-review-index';

export type StudyQueueKind = 'REMAINING' | 'DUE' | 'NEW' | 'COMPLETED';

export type RuntimeQueueSet = {
  DUE: StudyReviewItem[];
  NEW: StudyReviewItem[];
  COMPLETED: StudyReviewItem[];
  REMAINING: StudyReviewItem[];
};

export type GlobalStudyRuntimeIndex = {
  itemsByKey: Map<string, StudyReviewItem>;
  keysByCardId: Map<string, Set<string>>;
  keysBySourceId: Map<string, Set<string>>;
  keysByFileId: Map<string, Set<string>>;
  categoryKeys: Map<string, Set<string>>;
  queuesByScope: Map<string, RuntimeQueueSet>;
};

function compareQueue(kind: StudyQueueKind, left: StudyReviewItem, right: StudyReviewItem) {
  if (kind === 'COMPLETED') return (right.latestReviewTime ?? 0) - (left.latestReviewTime ?? 0);
  if (left.state === 'DUE' && right.state === 'NEW') return -1;
  if (left.state === 'NEW' && right.state === 'DUE') return 1;
  if (left.state === 'DUE' && right.state === 'DUE') {
    return (left.nextRepetitionTime ?? 0) - (right.nextRepetitionTime ?? 0);
  }
  return left.sourceOrder - right.sourceOrder || left.regionOrder - right.regionOrder;
}

function queueForItems(items: readonly StudyReviewItem[]): RuntimeQueueSet {
  const due = items.filter((item) => item.state === 'DUE').sort((a, b) => compareQueue('DUE', a, b));
  const newCards = items.filter((item) => item.state === 'NEW').sort((a, b) => compareQueue('NEW', a, b));
  const completed = items.filter((item) => item.reviewedToday).sort((a, b) => compareQueue('COMPLETED', a, b));
  const remaining = [...due, ...newCards].sort((a, b) => compareQueue('REMAINING', a, b));
  return { DUE: due, NEW: newCards, COMPLETED: completed, REMAINING: remaining };
}

function categoryMatches(item: StudyReviewItem, categoryId: string, library: StudyLibrary | null) {
  return categoryMatchesLocation(library, categoryId, {
    fileId: item.fileId,
    pageId: item.sourceId,
    cardId: item.cardId,
    maskId: item.regionId,
  });
}

function addToSetMap(map: Map<string, Set<string>>, id: string | null | undefined, key: string) {
  if (!id) return;
  const set = map.get(id) ?? new Set<string>();
  set.add(key);
  map.set(id, set);
}

/**
 * Pure in-memory projection of the persistent StudyReviewItem array.
 * No file reads and no RemNote API calls occur here.
 */
export function buildGlobalStudyRuntimeIndex(
  items: readonly StudyReviewItem[],
  library: StudyLibrary | null,
): GlobalStudyRuntimeIndex {
  const itemsByKey = new Map<string, StudyReviewItem>();
  const keysByCardId = new Map<string, Set<string>>();
  const keysBySourceId = new Map<string, Set<string>>();
  const keysByFileId = new Map<string, Set<string>>();
  const categoryKeys = new Map<string, Set<string>>();
  const queuesByScope = new Map<string, RuntimeQueueSet>();

  for (const item of items) {
    itemsByKey.set(item.key, item);
    addToSetMap(keysByCardId, item.cardId, item.key);
    addToSetMap(keysBySourceId, item.sourceId, item.key);
    addToSetMap(keysByFileId, item.fileId, item.key);
  }

  const scopeIds = ['all', ...(library?.categories.map((category) => category.category_id) ?? [])];
  for (const scopeId of scopeIds) {
    const scopeItems = scopeId === 'all' ? [...items] : items.filter((item) => categoryMatches(item, scopeId, library));
    categoryKeys.set(scopeId, new Set(scopeItems.map((item) => item.key)));
    queuesByScope.set(scopeId, queueForItems(scopeItems));
  }

  return { itemsByKey, keysByCardId, keysBySourceId, keysByFileId, categoryKeys, queuesByScope };
}

export function queueFromRuntimeIndex(
  runtime: GlobalStudyRuntimeIndex | null,
  scopeId: string,
  kind: StudyQueueKind,
) {
  return runtime?.queuesByScope.get(scopeId)?.[kind] ?? [];
}

export function countsFromRuntimeIndex(runtime: GlobalStudyRuntimeIndex | null, scopeId: string) {
  const queues = runtime?.queuesByScope.get(scopeId);
  return {
    due: queues?.DUE.length ?? 0,
    newCards: queues?.NEW.length ?? 0,
    completed: queues?.COMPLETED.length ?? 0,
    remaining: queues?.REMAINING.length ?? 0,
  };
}

function belongsToQueue(item: StudyReviewItem, kind: StudyQueueKind) {
  if (kind === 'DUE') return item.state === 'DUE';
  if (kind === 'NEW') return item.state === 'NEW';
  if (kind === 'COMPLETED') return item.reviewedToday;
  return item.state === 'DUE' || item.state === 'NEW';
}

function patchQueue(
  queue: readonly StudyReviewItem[],
  kind: StudyQueueKind,
  previousKey: string,
  replacement: StudyReviewItem,
  includeReplacement: boolean,
) {
  const next = queue.filter((item) => item.key !== previousKey && item.key !== replacement.key);
  if (includeReplacement && belongsToQueue(replacement, kind)) next.push(replacement);
  next.sort((a, b) => compareQueue(kind, a, b));
  return next;
}

/**
 * Incrementally replace one item. No file/RN reads and no full-scope item
 * projection occur here: only the affected scope sets and four queue arrays are
 * patched for this one card.
 */
export function replaceRuntimeStudyItem(
  runtime: GlobalStudyRuntimeIndex,
  previous: StudyReviewItem,
  replacement: StudyReviewItem,
  library: StudyLibrary | null,
) {
  runtime.itemsByKey.set(replacement.key, replacement);

  const scopeIds = ['all', ...(library?.categories.map((category) => category.category_id) ?? [])];
  for (const scopeId of scopeIds) {
    const beforeMatches = categoryMatches(previous, scopeId, library);
    const afterMatches = categoryMatches(replacement, scopeId, library);
    if (!beforeMatches && !afterMatches) continue;

    const keys = runtime.categoryKeys.get(scopeId) ?? new Set<string>();
    if (beforeMatches && previous.key !== replacement.key) keys.delete(previous.key);
    if (afterMatches) keys.add(replacement.key);
    else keys.delete(previous.key);
    runtime.categoryKeys.set(scopeId, keys);

    const current = runtime.queuesByScope.get(scopeId) ?? { DUE: [], NEW: [], COMPLETED: [], REMAINING: [] };
    runtime.queuesByScope.set(scopeId, {
      DUE: patchQueue(current.DUE, 'DUE', previous.key, replacement, afterMatches),
      NEW: patchQueue(current.NEW, 'NEW', previous.key, replacement, afterMatches),
      COMPLETED: patchQueue(current.COMPLETED, 'COMPLETED', previous.key, replacement, afterMatches),
      REMAINING: patchQueue(current.REMAINING, 'REMAINING', previous.key, replacement, afterMatches),
    });
  }
  return runtime;
}
