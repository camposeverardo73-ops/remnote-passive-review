import {
  PointerEvent as ReactPointerEvent,
  memo,
  WheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { QueueInteractionScore, renderWidget, usePlugin } from '@remnote/plugin-sdk';
import {
  MANUAL_REGION_BUILD_ID,
  collapseTechnicalCardContainer,
  clearManualRegionsAndBindings,
  readManualRegionDocument,
  repairManualRegionBindings,
  saveManualRegions,
  type ManualRegion,
  type ManualRegionDraft,
} from '../manual-region-store';
import {
  importMindmapFiles,
  readSourceLibrary,
  removeMindmapSource,
  resolveMindmapSourceImage,
  saveSourceLibrary,
  selectSource,
  UPLOAD_AUDIT_KEY,
  type MindmapSource,
  type MindmapSourceLibrary,
  type ImportAuditEvent,
} from '../mindmap-source-store';
import {
  canSubmitNativeScore,
  classifyNativeCard,
  makeInitialRegionState,
  revealOnlyTarget,
  type NativeCardState,
  type RatingState,
} from '../review-state';
import { MINDMAP_RETURN_REM_SESSION_KEY } from '../open-mindmap-pane';
import {
  addCustomStudyCategory,
  deleteStudyCategory,
  effectivePrimarySubjectId,
  isPrimarySubjectCategory,
  readStudyLibrary,
  renameStudyCategory,
  setActiveStudyCategory,
  setCategoryTargetMembership,
  setPrimarySubjectForTarget,
  setSourceCategoryMembership,
  sourceFileId,
  sourceIdsForCategory,
  targetMembership,
  type CategoryTargetType,
  type StudyLibrary,
} from '../study-library';
import {
  buildSourceStudyReviewIndex,
  buildStudyReviewIndex,
  filterStudyItemsForCategory,
  mergeSourceStudyItems,
  readPersistedStudyReviewIndex,
  refreshStudyReviewItem,
  replaceStudyItem,
  savePersistedStudyReviewIndex,
  type StudyReviewItem,
} from '../study-review-index';
import {
  buildGlobalStudyRuntimeIndex,
  countsFromRuntimeIndex,
  queueFromRuntimeIndex,
  replaceRuntimeStudyItem,
  type GlobalStudyRuntimeIndex,
} from '../global-study-index';
import { ensureReleaseMigrations } from '../release-migrations';
import { PluginErrorBoundary } from '../plugin-error-boundary';
import '../mindmap_viewer.css';

type Transform = { x: number; y: number; scale: number };
type Point = { x: number; y: number };
type ReviewMode = 'free' | 'review' | 'edit';
type SidePanel = 'cards' | 'library' | null;
type ReviewFilter = 'REMAINING' | 'DUE' | 'NEW' | 'COMPLETED';
type RegionSchedule = {
  state: NativeCardState;
  cardId: string | null;
  remId: string | null;
  nextRepetitionTime: number | null;
  lastRepetitionTime: number | null;
  repetitionHistoryLength: number | null;
  reviewedToday: boolean;
  latestReviewTime: number | null;
};
type RatingResult = {
  state: RatingState;
  nextRepetitionTime: number | null;
  nativeStateChanged?: boolean;
  score?: QueueInteractionScore;
  message?: string;
};
type NativeSnapshot = {
  card_id: string;
  rem_id: string;
  state: NativeCardState;
  next_repetition_time: number | null;
  last_repetition_time: number | null;
  repetition_history_length: number | null;
  repetition_history_fingerprint: string;
  latest_repetition_score: QueueInteractionScore | null;
  times_wrong_in_row: number | null;
  captured_at: string;
};
type EditorGesture = {
  type: 'draw' | 'move' | 'resize';
  pointerId: number;
  regionId: string;
  start: Point;
  original: ManualRegionDraft;
};

type NavigationAudit = {
  started_at: string;
  category_id: string;
  filter: ReviewFilter;
  target: { file_id: string; source_id: string; region_id: string; card_id: string | null };
  stages: { stage: 'NAV_START' | 'INDEX_LOOKUP' | 'FILE_SWITCH' | 'PAGE_SWITCH' | 'CARD_LOCATE' | 'RENDER_DONE'; elapsed_ms: number }[];
};

type ReviewSessionState = {
  scopeId: string;
  filter: ReviewFilter;
  queueCardIds: string[];
  currentCardId: string | null;
  position: number;
  startedAt: string;
};

type StudyRegionButtonProps = {
  region: ManualRegion;
  index: number;
  displayMasked: boolean;
  cardState: NativeCardState;
  completedToday: boolean;
  isReviewTarget: boolean;
  reviewPeer: boolean;
  queuePulse: boolean;
  mode: ReviewMode;
  onToggle: (regionId: string) => void;
};

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const RATING_AUDIT_KEY = 'manual-region-native-rating-audit-v1';
const NAVIGATION_AUDIT_SESSION_KEY = 'mindmap-navigation-audit-session-v1';

const scoreButtons = [
  { label: '重来', key: '1', score: QueueInteractionScore.AGAIN, tone: 'again' },
  { label: '困难', key: '2', score: QueueInteractionScore.HARD, tone: 'hard' },
  { label: '良好', key: '3', score: QueueInteractionScore.GOOD, tone: 'good' },
  { label: '简单', key: '4', score: QueueInteractionScore.EASY, tone: 'easy' },
] as const;

const stateLabels: Record<NativeCardState, string> = {
  NEW: '新卡',
  DUE: '到期',
  NOT_DUE: '未到期',
  UNMAPPED: '未绑定',
  UNKNOWN: '未知',
};

const StudyRegionButton = memo(function StudyRegionButton({
  region,
  index,
  displayMasked,
  cardState,
  completedToday,
  isReviewTarget,
  reviewPeer,
  queuePulse,
  mode,
  onToggle,
}: StudyRegionButtonProps) {
  return (
    <button
      className={`${displayMasked ? 'recall-region' : 'revealed-region-selector'} state-border-${cardState.toLowerCase()} ${completedToday ? 'completed-today' : ''} ${isReviewTarget ? 'review-target' : reviewPeer ? 'review-peer' : ''} ${queuePulse ? 'queue-entry-pulse' : ''}`}
      type="button"
      aria-label={mode === 'review' ? (isReviewTarget && displayMasked ? `显示当前问题答案 ${index + 1}` : `选择问题区域 ${index + 1}`) : displayMasked ? `揭示区域 ${index + 1}` : `选择区域 ${index + 1}`}
      data-region-id={region.region_id}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle(region.region_id);
      }}
      style={{
        left: `${region.x * 100}%`,
        top: `${region.y * 100}%`,
        width: `${region.width * 100}%`,
        height: `${region.height * 100}%`,
      }}
    >
      {mode === 'review' && completedToday ? (
        <span className="schedule-dot dot-completed" aria-label="今日已完成" />
      ) : mode === 'review' && (cardState === 'DUE' || cardState === 'NEW') ? (
        <span className={`schedule-dot dot-${cardState.toLowerCase()}`} aria-label={stateLabels[cardState]} />
      ) : null}
    </button>
  );
});

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function safeSetPointerCapture(element: Element & { setPointerCapture?: (pointerId: number) => void }, pointerId: number) {
  try {
    element.setPointerCapture?.(pointerId);
  } catch {
    // RN/React can dispatch a stale pointer event after a pane transition.
    // Pointer capture is an interaction enhancement, never a reason to crash review.
  }
}

function formatNextTime(value: number | null) {
  if (value === null) return '时间待确认';
  return new Date(value).toLocaleString();
}

function formatIntervalFromNow(value: number | null) {
  if (value === null) return '时间待确认';
  const diff = Math.max(0, value - Date.now());
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < hour) return `${Math.max(1, Math.round(diff / minute))} 分钟`;
  if (diff < day) return `${Math.max(1, Math.round(diff / hour))} 小时`;
  const days = diff / day;
  if (days < 30) return `${Math.max(1, Math.round(days))} 天`;
  if (days < 365) return `${Math.max(1, Math.round(days / 30))} 个月`;
  return `${(days / 365).toFixed(days >= 730 ? 0 : 1)} 年`;
}

function parsePageSelection(input: string, pageCount: number) {
  const trimmed = input.trim();
  if (!trimmed) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const pages = new Set<number>();
  for (const token of trimmed.split(',')) {
    const part = token.trim();
    if (!part) continue;
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Math.max(1, Number(range[1]));
      const end = Math.min(pageCount, Number(range[2]));
      for (let page = Math.min(start, end); page <= Math.max(start, end); page += 1) {
        if (page >= 1 && page <= pageCount) pages.add(page);
      }
      continue;
    }
    const page = Number(part);
    if (Number.isInteger(page) && page >= 1 && page <= pageCount) pages.add(page);
  }
  return Array.from(pages).sort((a, b) => a - b);
}


function normalizeUnixTime(value: number | Date | null | undefined) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value < 10_000_000_000 ? value * 1000 : value;
}

function isToday(value: number | null | undefined) {
  const normalized = normalizeUnixTime(value);
  if (normalized === null) return false;
  const date = new Date(normalized);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function reviewHistorySummary(card: { repetitionHistory?: readonly { date?: number | Date; score?: QueueInteractionScore }[]; lastRepetitionTime?: number }) {
  const historyDates = Array.isArray(card.repetitionHistory)
    ? card.repetitionHistory
        .map((entry) => normalizeUnixTime(entry?.date))
        .filter((value): value is number => value !== null)
    : [];
  const fallbackLast = normalizeUnixTime(card.lastRepetitionTime);
  const latestReviewTime = historyDates.length
    ? Math.max(...historyDates)
    : fallbackLast;
  return {
    reviewedToday: historyDates.some((value) => isToday(value)) || (historyDates.length === 0 && isToday(fallbackLast)),
    latestReviewTime,
  };
}

function makeRegionId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `manual-${uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function toPoint(event: ReactPointerEvent, element: HTMLElement): Point {
  const rect = element.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  };
}

function emptySchedule(regions: readonly ManualRegion[]) {
  return Object.fromEntries(
    regions.map((region) => [
      region.region_id,
      {
        state: region.binding_status === 'BOUND' ? 'UNKNOWN' : 'UNMAPPED',
        cardId: region.card_id,
        remId: region.rem_id,
        nextRepetitionTime: null,
        lastRepetitionTime: null,
        repetitionHistoryLength: null,
        reviewedToday: false,
        latestReviewTime: null,
      } as RegionSchedule,
    ]),
  ) as Record<string, RegionSchedule>;
}

function snapshotCard(
  card: NonNullable<Awaited<ReturnType<ReturnType<typeof usePlugin>['card']['findOne']>>>,
): NativeSnapshot {
  return {
    card_id: card._id,
    rem_id: card.remId,
    state: classifyNativeCard(card, true),
    next_repetition_time:
      typeof card.nextRepetitionTime === 'number' ? card.nextRepetitionTime : null,
    last_repetition_time:
      typeof card.lastRepetitionTime === 'number' ? card.lastRepetitionTime : null,
    repetition_history_length: Array.isArray(card.repetitionHistory)
      ? card.repetitionHistory.length
      : null,
    repetition_history_fingerprint: JSON.stringify(card.repetitionHistory ?? null),
    latest_repetition_score: (() => {
      const history = Array.isArray(card.repetitionHistory) ? card.repetitionHistory : [];
      const latest = history.reduce<(typeof history)[number] | undefined>((winner, entry) => {
        const entryTime = normalizeUnixTime(entry?.date) ?? Number.NEGATIVE_INFINITY;
        const winnerTime = normalizeUnixTime(winner?.date) ?? Number.NEGATIVE_INFINITY;
        return !winner || entryTime >= winnerTime ? entry : winner;
      }, undefined);
      return latest && typeof latest.score === 'number'
        ? (latest.score as QueueInteractionScore)
        : null;
    })(),
    times_wrong_in_row:
      typeof card.timesWrongInRow === 'number' ? card.timesWrongInRow : null,
    captured_at: new Date().toISOString(),
  };
}

function nativeSnapshotChanged(before: NativeSnapshot, after: NativeSnapshot) {
  return (
    before.next_repetition_time !== after.next_repetition_time ||
    before.last_repetition_time !== after.last_repetition_time ||
    before.repetition_history_length !== after.repetition_history_length ||
    before.repetition_history_fingerprint !== after.repetition_history_fingerprint ||
    before.latest_repetition_score !== after.latest_repetition_score ||
    before.times_wrong_in_row !== after.times_wrong_in_row ||
    before.state !== after.state
  );
}


function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function ratingBlockReason(
  mode: ReviewMode,
  regionId: string | null,
  regionState: Record<string, 'MASKED' | 'REVEALED'>,
  activeSchedule: RegionSchedule | undefined,
  activeRating: RatingResult | undefined,
) {
  if (mode !== 'review') return '仅“到期/新卡复习”模式可评分';
  if (!regionId) return '请先点击并揭示一个遮挡区域';
  if (regionState[regionId] !== 'REVEALED') return '请先揭示当前区域';
  if (!activeSchedule?.cardId || !activeSchedule.remId) return '当前区域尚未绑定原生卡';
  if (activeRating?.state === 'SAVING') return '正在提交评分';
  if (activeRating?.state === 'DONE') return '本次评分已提交';
  if (activeRating?.state === 'SAVE_UNKNOWN') return '上次评分结果不明确，为防重复已锁定';
  if (activeRating?.state === 'SAVE_FAILED') return '上次评分失败，请重新打开 Viewer 后再试';
  if (activeSchedule.state === 'UNKNOWN' || activeSchedule.state === 'UNMAPPED') {
    return '调度状态无法确认';
  }
  if (activeSchedule.state === 'NOT_DUE') return '该卡当前未到期；今日复习不会提前改写 RN 调度';
  return null;
}

function MindmapViewer() {
  const plugin = usePlugin();
  const [sourceLibrary, setSourceLibrary] = useState<MindmapSourceLibrary | null>(null);
  const [studyLibrary, setStudyLibrary] = useState<StudyLibrary | null>(null);
  const [studyIndex, setStudyIndex] = useState<StudyReviewItem[]>([]);
  const [studyIndexLoading, setStudyIndexLoading] = useState(false);
  const [studyIndexReady, setStudyIndexReady] = useState(false);
  const [runtimeIndexRevision, setRuntimeIndexRevision] = useState(0);
  const [sessionCompletedCardIds, setSessionCompletedCardIds] = useState<Set<string>>(() => new Set());
  const currentSource = useMemo<MindmapSource | null>(() => {
    if (!sourceLibrary) return null;
    return (
      sourceLibrary.sources.find((item) => item.source_id === sourceLibrary.current_source_id) ??
      sourceLibrary.sources[0] ??
      null
    );
  }, [sourceLibrary]);
  const [currentImageSrc, setCurrentImageSrc] = useState('');
  const [uploadAudit, setUploadAudit] = useState<ImportAuditEvent[]>([]);
  const [libraryFocusRegionId, setLibraryFocusRegionId] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryPagePickerOpen, setCategoryPagePickerOpen] = useState(false);
  const [categoryPreciseOpen, setCategoryPreciseOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [regions, setRegions] = useState<ManualRegion[]>([]);
  const activeRegions = useMemo(() => regions.filter((region) => region.active), [regions]);
  const regionIds = useMemo(
    () => activeRegions.map((region) => region.region_id),
    [activeRegions],
  );
  const [mode, setMode] = useState<ReviewMode>('review');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('REMAINING');
  const [regionState, setRegionState] = useState<Record<string, 'MASKED' | 'REVEALED'>>({});
  const [schedule, setSchedule] = useState<Record<string, RegionSchedule>>({});
  const [ratings, setRatings] = useState<Record<string, RatingResult>>({});
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [bindingErrors, setBindingErrors] = useState<Record<string, string>>({});
  const [sourceMessage, setSourceMessage] = useState<string | null>(null);
  const [pdfPageDialog, setPdfPageDialog] = useState<{
    fileName: string;
    pageCount: number;
    resolve: (value: number[] | null) => void;
  } | null>(null);
  const [pdfPageInput, setPdfPageInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [lastNativeSyncAt, setLastNativeSyncAt] = useState<number | null>(null);
  const [lastNativeWrite, setLastNativeWrite] = useState<{ label: string; interval: string | null; cardId: string } | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [sidePanel, setSidePanel] = useState<SidePanel>(null);
  const [pageListOpen, setPageListOpen] = useState(false);
  const [renamingSourceId, setRenamingSourceId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const pageClickTimer = useRef<number | null>(null);

  const renameSource = async (sourceId: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    setRenamingSourceId(null);
    if (!trimmed || !sourceLibrary) return;
    const nextSources = sourceLibrary.sources.map((s) =>
      s.source_id === sourceId ? { ...s, title: trimmed } : s,
    );
    const nextLibrary = { ...sourceLibrary, sources: nextSources };
    setSourceLibrary(nextLibrary);
    try {
      await saveSourceLibrary(plugin, nextLibrary);
    } catch {
      // In-memory state is updated; persistence will be retried on next save.
    }
  };
  const [drafts, setDrafts] = useState<ManualRegionDraft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'IDLE' | 'SAVING' | 'ERROR'>('IDLE');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const [queuePulseRegionId, setQueuePulseRegionId] = useState<string | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const panStart = useRef<{ pointer: Point; transform: Transform } | null>(null);
  const pinchStart = useRef<{
    distance: number;
    midpoint: Point;
    transform: Transform;
  } | null>(null);
  const editorLayerRef = useRef<HTMLDivElement | null>(null);
  const editorGesture = useRef<EditorGesture | null>(null);
  const inFlightCardIds = useRef(new Set<string>());
  const unknownOutcomeCardIds = useRef(new Set<string>());
  const activeRegionIdRef = useRef<string | null>(null);
  const modeRef = useRef<ReviewMode>('review');
  const regionStateRef = useRef<Record<string, 'MASKED' | 'REVEALED'>>({});
  const revealedRegionIdRef = useRef<string | null>(null);
  const reviewSessionRef = useRef<ReviewSessionState | null>(null);
  const advanceAfterScoreRef = useRef<((indexOverride?: readonly StudyReviewItem[]) => Promise<void>) | null>(null);
  const indexInitializedRef = useRef(false);
  const runtimeIndexRef = useRef<GlobalStudyRuntimeIndex | null>(null);
  const studyIndexRef = useRef<StudyReviewItem[]>([]);
  modeRef.current = mode;
  regionStateRef.current = regionState;

  const commitStudyIndex = useCallback((items: readonly StudyReviewItem[]) => {
    const next = [...items];
    studyIndexRef.current = next;
    setStudyIndex(next);
    return next;
  }, []);

  const openCardsPanel = useCallback(() => {
    setMoreOpen(false);
    setSidePanel((current) => (current === 'cards' ? null : 'cards'));
  }, []);

  const openStudyLibraryPanel = useCallback(() => {
    setMoreOpen(false);
    setLibraryFocusRegionId(null);
    setCategoryPagePickerOpen(false);
    setCategoryPreciseOpen(false);
    setSidePanel((current) => (current === 'library' ? null : 'library'));
  }, []);

  const openRegionCategoryPanel = useCallback((regionId: string) => {
    setMoreOpen(false);
    setLibraryFocusRegionId(regionId);
    setSidePanel('library');
  }, []);



  useEffect(() => {
    let cancelled = false;
    if (!currentSource) {
      setCurrentImageSrc('');
      return;
    }
    void resolveMindmapSourceImage(plugin, currentSource)
      .then((src) => {
        if (!cancelled) setCurrentImageSrc(src);
      })
      .catch((caught) => {
        if (!cancelled) {
          setCurrentImageSrc(currentSource.image_src || '');
          setSourceMessage(caught instanceof Error ? caught.message : String(caught));
        }
      });
    return () => { cancelled = true; };
  }, [plugin, currentSource?.source_id, currentSource?.asset_key, currentSource?.image_src]);

  const returnToRemNote = useCallback(async () => {
    setMoreOpen(false);
    try {
      const activeRegion = activeRegionIdRef.current;
      const nativeRemId = activeRegion ? schedule[activeRegion]?.remId ?? null : null;
      const returnRemId = nativeRemId ?? await plugin.storage.getSession<string>(MINDMAP_RETURN_REM_SESSION_KEY);
      if (!returnRemId) {
        setSourceMessage('无法打开该笔记，请重试。');
        return;
      }
      const target = await plugin.rem.findOne(returnRemId);
      if (!target) {
        setSourceMessage('无法打开该笔记，请重试。');
        return;
      }
      // Native Rem object navigation: do not parse/replay window strings and do
      // not pass widget pane ids back into WindowNamespace.
      await target.openRemAsPage();
    } catch (caught) {
      console.error('[Mindmap][RN_NATIVE_NAVIGATION_FAIL]', {
        error_source: 'returnToRemNote',
        caller: 'Rem.openRemAsPage',
        parser: 'none in plugin',
        expected_format: 'native Rem object',
        actual_format: 'Rem instance from plugin.rem.findOne',
        fail_reason: caught instanceof Error ? caught.message : String(caught),
      });
      setSourceMessage('无法打开该笔记，请重试。');
    }
  }, [plugin, schedule]);

  const resetForRegions = useCallback((ids: readonly string[]) => {
    const nextState = makeInitialRegionState(ids);
    regionStateRef.current = nextState;
    revealedRegionIdRef.current = null;
    setRegionState(nextState);
    setRatings({});
    setActiveRegionId(null);
    activeRegionIdRef.current = null;
  }, []);

  const refreshNativeState = useCallback(
    async (sourceRegions: readonly ManualRegion[], merge = false) => {
      setReadError(null);
      const pairs = await Promise.all(
        sourceRegions.map(async (region) => {
          const hasBinding =
            region.binding_status === 'BOUND' && !!region.card_id && !!region.rem_id;
          if (!hasBinding) {
            return [
              region.region_id,
              {
                state: 'UNMAPPED',
                cardId: region.card_id,
                remId: region.rem_id,
                nextRepetitionTime: null,
                lastRepetitionTime: null,
                repetitionHistoryLength: null,
                reviewedToday: false,
                latestReviewTime: null,
              } as RegionSchedule,
            ] as const;
          }
          try {
            const card = await plugin.card.findOne(region.card_id ?? undefined);
            const history = card
              ? reviewHistorySummary(card)
              : { reviewedToday: false, latestReviewTime: null };
            return [
              region.region_id,
              {
                state: classifyNativeCard(card, true),
                cardId: region.card_id,
                remId: region.rem_id,
                nextRepetitionTime:
                  typeof card?.nextRepetitionTime === 'number' ? normalizeUnixTime(card.nextRepetitionTime) : null,
                lastRepetitionTime:
                  typeof card?.lastRepetitionTime === 'number' ? normalizeUnixTime(card.lastRepetitionTime) : null,
                repetitionHistoryLength:
                  card && Array.isArray(card.repetitionHistory)
                    ? card.repetitionHistory.length
                    : null,
                reviewedToday: history.reviewedToday,
                latestReviewTime: history.latestReviewTime,
              } as RegionSchedule,
            ] as const;
          } catch (caught) {
            return [
              region.region_id,
              {
                state: 'UNKNOWN',
                cardId: region.card_id,
                remId: region.rem_id,
                nextRepetitionTime: null,
                lastRepetitionTime: null,
                repetitionHistoryLength: null,
                reviewedToday: false,
                latestReviewTime: null,
              } as RegionSchedule,
            ] as const;
          }
        }),
      );
      const nextSchedule = Object.fromEntries(pairs) as Record<string, RegionSchedule>;
      setSchedule((current) => (merge ? { ...current, ...nextSchedule } : nextSchedule));
      setLastNativeSyncAt(Date.now());
      return nextSchedule;
    },
    [plugin],
  );

  const syncCurrentPageWithRN = useCallback(
    async (showMessage = false) => {
      if (showMessage) setSourceMessage('正在从 RemNote Native Card 刷新真实学习状态…');
      await refreshNativeState(activeRegions);
      if (showMessage) {
        setSourceMessage('已从 RemNote Native Card / repetitionHistory 刷新本页学习状态。');
        window.setTimeout(() => {
          setSourceMessage((current) =>
            current?.startsWith('已从 RemNote Native Card') ? null : current,
          );
        }, 1800);
      }
    },
    [activeRegions, refreshNativeState],
  );

  const loadRegions = useCallback(
    async (requestedSourceId?: string, options?: { preserveFilter?: boolean; targetRegionId?: string }) => {
      setLoading(true);
      setReadError(null);
      try {
        await plugin.app.waitForInitialSync();
        const releaseMigration = await ensureReleaseMigrations(plugin);
        if (releaseMigration.legacy_asset === 'PENDING_ASSET') {
          console.warn('[Mindmap][RELEASE_MIGRATION_PENDING]', releaseMigration.pending_reason);
          setSourceMessage('检测到旧版页面资源尚未完成迁移；请在原设备联网打开一次插件后重试。');
        }
        let library = await readSourceLibrary(plugin);
        const nextStudyLibrary = await readStudyLibrary(plugin);
        setStudyLibrary(nextStudyLibrary);
        if (requestedSourceId && library.current_source_id !== requestedSourceId) {
          library = await selectSource(plugin, requestedSourceId);
        }
        const source =
          library.sources.find((item) => item.source_id === library.current_source_id) ??
          library.sources[0];
        setSourceLibrary(library);
        if (!source) {
          setRegions([]);
          setSchedule({});
          resetForRegions([]);
          setSourceMessage('当前没有页面，可点“加入页面”导入。');
          return;
        }
        if (!options?.preserveFilter) setReviewFilter('REMAINING');
        const document = await readManualRegionDocument(plugin, source);
        const active = document.regions.filter((region) => region.active);
        setRegions(document.regions);
        resetForRegions(active.map((region) => region.region_id));
        await refreshNativeState(active);
        if (options?.targetRegionId && active.some((region) => region.region_id === options.targetRegionId)) {
          activeRegionIdRef.current = options.targetRegionId;
          setActiveRegionId(options.targetRegionId);
        }
        if (source) await collapseTechnicalCardContainer(plugin, source);
      } catch (caught) {
        setReadError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setLoading(false);
      }
    },
    [plugin, refreshNativeState, resetForRegions],
  );

  const activeStudyCategoryId = studyLibrary?.active_category_id ?? 'all';
  const activeStudyCategory = studyLibrary?.categories.find((item) => item.category_id === activeStudyCategoryId) ?? null;
  const allSources = useMemo(() => sourceLibrary?.sources ?? [], [sourceLibrary?.sources]);

  const installRuntimeIndex = useCallback((items: readonly StudyReviewItem[], libraryOverride?: StudyLibrary | null) => {
    runtimeIndexRef.current = buildGlobalStudyRuntimeIndex(items, libraryOverride === undefined ? studyLibrary : libraryOverride);
    setRuntimeIndexRevision((current) => current + 1);
  }, [studyLibrary]);

  const scopedStudyItems = useMemo(() => {
    void runtimeIndexRevision;
    const runtime = runtimeIndexRef.current;
    if (!runtime) return filterStudyItemsForCategory(studyIndex, studyLibrary, activeStudyCategoryId);
    const keys = runtime.categoryKeys.get(activeStudyCategoryId) ?? new Set<string>();
    const result: StudyReviewItem[] = [];
    for (const key of keys) {
      const item = runtime.itemsByKey.get(key);
      if (item) result.push(item);
    }
    return result;
  }, [runtimeIndexRevision, studyIndex, studyLibrary, activeStudyCategoryId]);

  const rebuildGlobalStudyIndex = useCallback(async (sourcesOverride?: readonly MindmapSource[]) => {
    const sources = sourcesOverride ?? allSources;
    setStudyIndexLoading(true);
    try {
      const next = await buildStudyReviewIndex(plugin, sources);
      commitStudyIndex(next);
      installRuntimeIndex(next);
      setStudyIndexReady(true);
      await savePersistedStudyReviewIndex(plugin, sources, next);
      return next;
    } finally {
      setStudyIndexLoading(false);
    }
  }, [plugin, allSources, installRuntimeIndex, commitStudyIndex]);

  const refreshSourceIndex = useCallback(async (source: MindmapSource) => {
    const sourceOrder = allSources.findIndex((item) => item.source_id === source.source_id);
    const replacement = await buildSourceStudyReviewIndex(plugin, source, Math.max(0, sourceOrder));
    const nextIndex = mergeSourceStudyItems(studyIndexRef.current, source.source_id, replacement);
    commitStudyIndex(nextIndex);
    installRuntimeIndex(nextIndex);
    if (allSources.length) await savePersistedStudyReviewIndex(plugin, allSources, nextIndex);
    setStudyIndexReady(true);
    return nextIndex;
  }, [plugin, allSources, installRuntimeIndex, commitStudyIndex]);

  useEffect(() => {
    if (!sourceLibrary || !studyLibrary || indexInitializedRef.current) return;
    indexInitializedRef.current = true;
    let cancelled = false;
    const sources = sourceLibrary.sources;
    setStudyIndexReady(false);
    setStudyIndexLoading(true);
    void (async () => {
      try {
        const cached = await readPersistedStudyReviewIndex(plugin, sources);
        if (cancelled) return;
        if (cached) {
          // Fast path: restore the persistent index immediately. Current-page RN
          // state is refreshed on focus/load; explicit “重新连接” remains the
          // full-library reconciliation path.
          // Prune orphaned entries whose sourceId no longer exists (e.g. pages
          // deleted outside the plugin, or stale entries from pre-patch-9 imports).
          // Only removes orphans; never touches valid items.
          const validSourceIds = new Set(sources.map((s) => s.source_id));
          const pruned = cached.filter((item) => validSourceIds.has(item.sourceId));
          if (pruned.length !== cached.length) {
            await savePersistedStudyReviewIndex(plugin, sources, pruned);
          }
          commitStudyIndex(pruned);
          installRuntimeIndex(pruned, studyLibrary);
          setStudyIndexReady(true);
          return;
        }
        const fresh = await buildStudyReviewIndex(plugin, sources);
        if (cancelled) return;
        commitStudyIndex(fresh);
        installRuntimeIndex(fresh, studyLibrary);
        setStudyIndexReady(true);
        await savePersistedStudyReviewIndex(plugin, sources, fresh);
      } finally {
        if (!cancelled) setStudyIndexLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [plugin, sourceLibrary, studyLibrary, installRuntimeIndex, commitStudyIndex]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setViewportSize({ width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    void loadRegions();
  }, [loadRegions]);

  useEffect(() => {
    if (mode !== 'review' || !activeRegions.length) return;
    const sync = () => {
      void syncCurrentPageWithRN(false);
      if (currentSource) void refreshSourceIndex(currentSource);
    };
    const onFocus = () => sync();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') sync();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [mode, activeRegions, syncCurrentPageWithRN, currentSource, refreshSourceIndex]);

  const switchMode = (nextMode: 'free' | 'review') => {
    setMode(nextMode);
    if (nextMode === 'review') setReviewFilter('REMAINING');
    resetForRegions(regionIds);
    if (nextMode === 'review') void syncCurrentPageWithRN(false);
  };

  const enterEditor = () => {
    setMode('edit');
    setTransform({ x: 0, y: 0, scale: 1 });
    setDrafts(
      activeRegions.map(({ region_id, label, x, y, width, height }) => ({
        region_id,
        label,
        x,
        y,
        width,
        height,
      })),
    );
    setSelectedDraftId(null);
    setSaveState('IDLE');
    setSaveMessage(null);
  };

  const cancelEditor = () => {
    setMode('review');
    setDrafts([]);
    setSelectedDraftId(null);
    resetForRegions(regionIds);
  };

  const saveEditor = async () => {
    if (saveState === 'SAVING' || !currentSource) return;
    setSaveState('SAVING');
    setSaveMessage('正在保存遮挡并自动绑定原生卡…');
    try {
      const result = await saveManualRegions(plugin, currentSource, drafts);
      const active = result.document.regions.filter((region) => region.active);
      setBindingErrors(result.errors);
      setRegions(result.document.regions);
      setMode('review');
      setDrafts([]);
      setSelectedDraftId(null);
      resetForRegions(active.map((region) => region.region_id));
      await refreshNativeState(active);
      if (currentSource) await refreshSourceIndex(currentSource);
      if (currentSource) await collapseTechnicalCardContainer(plugin, currentSource);
      setSaveState(Object.keys(result.errors).length ? 'ERROR' : 'IDLE');
      setSaveMessage(
        Object.keys(result.errors).length
          ? `${Object.keys(result.errors).length} 个区域暂未绑定，可点“修复绑定”重试。`
          : null,
      );
    } catch (caught) {
      setSaveState('ERROR');
      setSaveMessage(caught instanceof Error ? caught.message : String(caught));
      if (currentSource) {
        const document = await readManualRegionDocument(plugin, currentSource);
        setRegions(document.regions);
      }
    }
  };

  const repairBindings = async (onlyRegionIds?: readonly string[]) => {
    if (!currentSource || saveState === 'SAVING') return;
    setSaveState('SAVING');
    setSaveMessage('正在修复未绑定区域…');
    try {
      const result = await repairManualRegionBindings(plugin, currentSource, onlyRegionIds);
      const active = result.document.regions.filter((region) => region.active);
      setRegions(result.document.regions);
      setBindingErrors(result.errors);
      await refreshNativeState(active);
      if (currentSource) await refreshSourceIndex(currentSource);
      if (currentSource) await collapseTechnicalCardContainer(plugin, currentSource);
      setSaveState(Object.keys(result.errors).length ? 'ERROR' : 'IDLE');
      setSaveMessage(
        Object.keys(result.errors).length
          ? `${Object.keys(result.errors).length} 个区域仍未绑定。`
          : '绑定已修复。',
      );
    } catch (caught) {
      setSaveState('ERROR');
      setSaveMessage(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const clearAllBindingsAndOcclusions = async () => {
    if (!currentSource || saveState === 'SAVING') return;
    const sources = sourceLibrary?.sources ?? [currentSource];
    if (!sources.length) return;
    const confirmed = window.confirm(
      `清空全部 ${sources.length} 页的旧绑定和遮挡？\n\n` +
      '会删除插件保存的所有 Region 遮挡框与 Region→Rem/Card 映射，并尽量停用仍可确认归属本插件的旧学习 Rem。\n' +
      '不会删除 Rem / Native Card / repetitionHistory / FSRS 历史。清空后请在“遮挡编辑”里重新画框并保存绑定。',
    );
    if (!confirmed) return;

    setMoreOpen(false);
    setSidePanel(null);
    setSaveState('SAVING');
    setSaveMessage(null);
    setSourceMessage('正在清空全部旧绑定与遮挡…');
    try {
      let clearedRegions = 0;
      let disabledPracticeRems = 0;
      const warnings: string[] = [];
      for (const source of sources) {
        const result = await clearManualRegionsAndBindings(plugin, source);
        clearedRegions += result.clearedRegions;
        disabledPracticeRems += result.disabledPracticeRems;
        warnings.push(...result.warnings);
      }

      setRegions([]);
      setBindingErrors({});
      setSchedule({});
      commitStudyIndex([]);
      installRuntimeIndex([], studyLibrary);
      if (sources.length) await savePersistedStudyReviewIndex(plugin, sources, []);
      setRatings({});
      unknownOutcomeCardIds.current.clear();
      inFlightCardIds.current.clear();
      setReviewFilter('REMAINING');
      resetForRegions([]);
      setDrafts([]);
      setSelectedDraftId(null);
      setMode('edit');
      setSaveState('IDLE');
      const warningText = warnings.length ? ` · ${warnings.length} 项旧 RN 对象无法安全确认，未擅自修改` : '';
      setSourceMessage(
        `已清空 ${clearedRegions} 个旧遮挡与绑定；已停用 ${disabledPracticeRems} 个可确认的旧插件学习 Rem${warningText}。旧 Rem/Card/FSRS 历史保留。现在可重新画遮挡。`,
      );
    } catch (caught) {
      setSaveState('ERROR');
      setSourceMessage(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const reveal = useCallback((regionId: string) => {
    const current = regionStateRef.current;
    if (!(regionId in current)) return;

    const currentlyRevealed = current[regionId] === 'REVEALED';
    const next = { ...current };
    if (currentlyRevealed) {
      next[regionId] = 'MASKED';
      if (revealedRegionIdRef.current === regionId) revealedRegionIdRef.current = null;
    } else {
      const previousRevealed = modeRef.current === 'review' ? revealedRegionIdRef.current : null;
      if (previousRevealed && previousRevealed !== regionId && next[previousRevealed] === 'REVEALED') {
        next[previousRevealed] = 'MASKED';
      }
      next[regionId] = 'REVEALED';
      revealedRegionIdRef.current = regionId;
    }

    regionStateRef.current = next;
    activeRegionIdRef.current = regionId;
    setActiveRegionId(regionId);
    setRegionState(next);


  }, []);

  const cancelPdfPageDialog = () => {
    const dialog = pdfPageDialog;
    if (!dialog) return;
    setPdfPageDialog(null);
    dialog.resolve(null);
  };

  const confirmPdfPageDialog = () => {
    const dialog = pdfPageDialog;
    if (!dialog) return;
    const pages = parsePageSelection(pdfPageInput, dialog.pageCount);
    setPdfPageDialog(null);
    dialog.resolve(pages);
  };

  const importImages = async (files: readonly File[]) => {
    if (!files.length) return;
    const events: ImportAuditEvent[] = [];
    const onStage = (event: ImportAuditEvent) => {
      events.push(event);
      setUploadAudit([...events]);
      setSourceMessage(`${event.stage}${event.detail ? ` · ${event.detail}` : ''}`);
    };
    setSourceMessage(`FILE_PICKED · ${files.length} 个文件`);
    try {
      const imported = await importMindmapFiles(plugin, files, {
        onStage,
        selectPdfPages: (file, pageCount) =>
          new Promise<number[] | null>((resolve) => {
            setPdfPageInput('');
            setPdfPageDialog({ fileName: file.name, pageCount, resolve });
          }),
      });
      await plugin.storage.setSession(UPLOAD_AUDIT_KEY, events.slice(-120));
      let nextStudyLibrary = studyLibrary;
      if (
        nextStudyLibrary &&
        activeStudyCategoryId !== 'all' &&
        activeStudyCategoryId !== 'tcm-all'
      ) {
        for (const source of imported.sources) {
          nextStudyLibrary = await setSourceCategoryMembership(
            plugin,
            nextStudyLibrary,
            activeStudyCategoryId,
            source.source_id,
            true,
          );
        }
        setStudyLibrary(nextStudyLibrary);
        installRuntimeIndex(studyIndex, nextStudyLibrary);
      }
      setSourceLibrary(imported.library);
      setTransform({ x: 0, y: 0, scale: 1 });
      await loadRegions(imported.source.source_id);
      onStage({ stage: 'INDEX_UPDATE', file_name: files[0].name, detail: `${imported.sources.length} pages`, at: new Date().toISOString() });
      try {
        // Rebuild the study index from all sources (including the newly imported
        // pages). The old code just copied the previous index, so newly added
        // cards were invisible to the review filters and cross-page navigation.
        const nextIndex = await buildStudyReviewIndex(plugin, imported.library.sources);
        commitStudyIndex(nextIndex);
        installRuntimeIndex(nextIndex, nextStudyLibrary);
        await savePersistedStudyReviewIndex(plugin, imported.library.sources, nextIndex);
      } catch (caught) {
        const detail = caught instanceof Error ? caught.message : String(caught);
        onStage({ stage: 'INDEX_FAIL', file_name: files[0].name, detail, at: new Date().toISOString() });
        throw new Error(`INDEX_FAIL: 导入页面已保存，但学习索引更新失败：${detail}`);
      }
      setStudyIndexReady(true);
      onStage({ stage: 'UI_RENDER', file_name: files[0].name, detail: imported.source.title, at: new Date().toISOString() });
      await plugin.storage.setSession(UPLOAD_AUDIT_KEY, events.slice(-120));
      setSourceMessage(`已加入 ${imported.sources.length} 页 · 当前 ${imported.source.title} · 可立即编辑遮挡/分类`);
      setMode('edit');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (message.includes('IMPORT_CANCELLED')) {
        await plugin.storage.setSession(UPLOAD_AUDIT_KEY, events.slice(-120));
        setSourceMessage('已取消导入。');
        return;
      }
      if (!events.some((event) => event.stage.endsWith('_FAIL'))) {
        const stage: ImportAuditEvent['stage'] = message.includes('INDEX') ? 'INDEX_FAIL' : message.includes('PERSIST') ? 'PERSIST_FAIL' : message.includes('DECODE') ? 'DECODE_FAIL' : 'FILE_READ_FAIL';
        onStage({ stage, file_name: files[0]?.name ?? 'unknown', detail: message, at: new Date().toISOString() });
      }
      await plugin.storage.setSession(UPLOAD_AUDIT_KEY, events.slice(-120));
      setSourceMessage(message);
    }
  };

  const changeSource = async (sourceId: string) => {
    setReviewFilter('REMAINING');
    setTransform({ x: 0, y: 0, scale: 1 });
    setMode('review');
    await loadRegions(sourceId);
  };

  const deleteCurrentPage = async () => {
    if (!currentSource) return;
    const confirmed = window.confirm(
      `删除当前页面“${currentSource.title}”？\n\n只会从 Mindmap 页面列表移除，并保留其 Rem / Native Card / FSRS 数据，避免破坏现有调度。`,
    );
    if (!confirmed) return;
    setSourceMessage('正在删除当前页面…');
    try {
      const result = await removeMindmapSource(plugin, currentSource.source_id);
      setSourceLibrary(result.library);
      const nextIndex = studyIndex.filter((item) => item.sourceId !== currentSource.source_id);
      commitStudyIndex(nextIndex);
      installRuntimeIndex(nextIndex);
      await savePersistedStudyReviewIndex(plugin, result.library.sources, nextIndex);
      setRegions([]);
      setSchedule({});
      setRatings({});
      setActiveRegionId(null);
      activeRegionIdRef.current = null;
      setTransform({ x: 0, y: 0, scale: 1 });
      if (result.source) {
        await loadRegions(result.source.source_id);
        setSourceMessage(`已删除页面“${result.removed.title}”`);
      } else {
        resetForRegions([]);
        setSourceMessage('页面已删除。当前没有页面，可点“加入页面”导入。');
      }
    } catch (caught) {
      setSourceMessage(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const zoomBy = (factor: number) => {
    setTransform((current) => ({
      ...current,
      scale: clamp(current.scale * factor, MIN_SCALE, MAX_SCALE),
    }));
  };

  const fitView = () => {
    setTransform({ x: 0, y: 0, scale: 1 });
    const measure = () => {
      const element = viewportRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      setViewportSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
    };
    measure();
    window.requestAnimationFrame(() => {
      measure();
      window.requestAnimationFrame(measure);
    });
    setSourceMessage('已适应当前屏幕 · 保持原图比例');
    window.setTimeout(() => {
      setSourceMessage((current) => current?.startsWith('已适应当前屏幕') ? null : current);
    }, 1600);
  };

  const reset = () => resetForRegions(regionIds);


  const submitScore = async (regionId: string, score: QueueInteractionScore) => {
    const currentSchedule = schedule[regionId];
    const currentRating = ratings[regionId]?.state ?? 'IDLE';
    if (
      !currentSchedule?.cardId ||
      inFlightCardIds.current.has(currentSchedule.cardId) ||
      unknownOutcomeCardIds.current.has(currentSchedule.cardId) ||
      !canSubmitNativeScore(
        mode === 'review' ? 'review' : 'free',
        regionState[regionId],
        currentSchedule.state,
        currentRating,
      )
    ) {
      return;
    }

    const cardId = currentSchedule.cardId;
    inFlightCardIds.current.add(cardId);
    setRatings((current) => ({
      ...current,
      [regionId]: { state: 'SAVING', nextRepetitionTime: null, score },
    }));

    try {
      if (!currentSource) throw new Error('当前脑图来源不可用。');
      const document = await readManualRegionDocument(plugin, currentSource);
      const locked = document.regions.find((region) => region.region_id === regionId);
      if (
        activeRegionIdRef.current !== regionId ||
        !locked?.active ||
        locked.binding_status !== 'BOUND' ||
        locked.card_id !== cardId ||
        locked.rem_id !== currentSchedule.remId
      ) {
        throw new Error('评分前绑定已改变。');
      }
      const card = await plugin.card.findOne(cardId);
      if (!card || card._id !== cardId || card.remId !== currentSchedule.remId) {
        throw new Error('评分前无法确认原生卡。');
      }
      const before = snapshotCard(card);
      try {
        await card.updateCardRepetitionStatus(score);
      } catch (caught) {
        unknownOutcomeCardIds.current.add(cardId);
        setRatings((current) => ({
          ...current,
          [regionId]: {
            state: 'SAVE_UNKNOWN',
            nextRepetitionTime: null,
            score,
            message: '评分结果不明确；为防重复，本次会话已锁定这张卡。',
          },
        }));
        return;
      }
      let refreshed = await plugin.card.findOne(cardId);
      let after =
        refreshed && refreshed._id === cardId && refreshed.remId === currentSchedule.remId
          ? snapshotCard(refreshed)
          : null;
      // RN may persist scheduler data asynchronously. Perform a few bounded
      // verification reads, never a background poll or a speculative second score.
      for (const delay of [120, 320, 700]) {
        const scoreVerified =
          !!after &&
          nativeSnapshotChanged(before, after) &&
          after.latest_repetition_score === score;
        if (scoreVerified) break;
        await sleep(delay);
        refreshed = await plugin.card.findOne(cardId);
        after =
          refreshed && refreshed._id === cardId && refreshed.remId === currentSchedule.remId
            ? snapshotCard(refreshed)
            : null;
      }
      const changed = !!after && nativeSnapshotChanged(before, after);
      const scoreVerified = !!after && changed && after.latest_repetition_score === score;
      await plugin.storage.setSession(RATING_AUDIT_KEY, {
        audit_version: 2,
        region_id: regionId,
        card_id: cardId,
        score,
        before,
        after,
        native_state_changed: changed,
        native_score_verified: scoreVerified,
        submitted_at: new Date().toISOString(),
      });
      if (!refreshed || !after || !scoreVerified) {
        unknownOutcomeCardIds.current.add(cardId);
        setRatings((current) => ({
          ...current,
          [regionId]: {
            state: 'SAVE_UNKNOWN',
            nextRepetitionTime: after?.next_repetition_time ?? null,
            score,
            nativeStateChanged: changed,
            message: '已调用 RN 评分，但未读回同一评分记录；为防重复，不自动下一题。',
          },
        }));
        setSourceMessage('RN 写入结果未完成闭环验证；当前卡已锁定，未伪造成功状态。');
        return;
      }
      setRatings((current) => ({
        ...current,
        [regionId]: {
          state: 'DONE',
          nextRepetitionTime: after.next_repetition_time,
          score,
          nativeStateChanged: true,
        },
      }));
      const history = reviewHistorySummary(refreshed);
      setSchedule((current) => ({
        ...current,
        [regionId]: {
          state: after.state,
          cardId,
          remId: after.rem_id,
          nextRepetitionTime: normalizeUnixTime(after.next_repetition_time),
          lastRepetitionTime: normalizeUnixTime(after.last_repetition_time),
          repetitionHistoryLength: after.repetition_history_length,
          reviewedToday: history.reviewedToday,
          latestReviewTime: history.latestReviewTime,
        },
      }));
      setRegionState((current) => ({ ...current, [regionId]: 'MASKED' }));
      setSessionCompletedCardIds((current) => {
        const next = new Set(current);
        next.add(cardId);
        return next;
      });
      let indexAfterScore = studyIndex;
      const indexedItem = studyIndex.find((item) => item.cardId === cardId && item.regionId === regionId);
      if (indexedItem) {
        const refreshedItem = await refreshStudyReviewItem(plugin, indexedItem);
        indexAfterScore = replaceStudyItem(studyIndex, refreshedItem);
        commitStudyIndex(indexAfterScore);
        if (runtimeIndexRef.current) {
          replaceRuntimeStudyItem(runtimeIndexRef.current, indexedItem, refreshedItem, studyLibrary);
          setRuntimeIndexRevision((current) => current + 1);
        } else {
          installRuntimeIndex(indexAfterScore);
        }
        if (allSources.length) await savePersistedStudyReviewIndex(plugin, allSources, indexAfterScore);
      }
      const scoredChoice = scoreButtons.find((choice) => choice.score === score);
      const nextInterval = normalizeUnixTime(after.next_repetition_time);
      setLastNativeWrite({
        label: scoredChoice?.label ?? '评分',
        interval: nextInterval ? formatIntervalFromNow(nextInterval) : null,
        cardId,
      });
      setSourceMessage(
        `${scoredChoice?.label ?? '评分'}已由 RN repetitionHistory 回读验证${nextInterval ? ` · RN 实际下次 ${formatIntervalFromNow(nextInterval)}` : ' · RN 未提供可读的下次时间'}。`,
      );
      const advance = advanceAfterScoreRef.current;
      if (advance) {
        await advance(indexAfterScore);
        setSourceMessage(
          `${scoredChoice?.label ?? '评分'}已由 RN repetitionHistory 回读验证${nextInterval ? ` · RN 实际下次 ${formatIntervalFromNow(nextInterval)}` : ''} · 学习队列已刷新`,
        );
      } else {
        activeRegionIdRef.current = null;
        setActiveRegionId(null);
      }
    } catch (caught) {
      setRatings((current) => ({
        ...current,
        [regionId]: {
          state: 'SAVE_FAILED',
          nextRepetitionTime: null,
          score,
          message: caught instanceof Error ? caught.message : String(caught),
        },
      }));
    } finally {
      inFlightCardIds.current.delete(cardId);
    }
  };

  const onViewportPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mode === 'edit') return;
    safeSetPointerCapture(event.currentTarget, event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      panStart.current = { pointer: { x: event.clientX, y: event.clientY }, transform };
      pinchStart.current = null;
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = {
        distance: Math.max(distance(a, b), 1),
        midpoint: midpoint(a, b),
        transform,
      };
      panStart.current = null;
    }
  };

  const onViewportPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mode === 'edit' || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const currentMidpoint = midpoint(a, b);
      const start = pinchStart.current;
      const nextScale = clamp(
        start.transform.scale * (distance(a, b) / start.distance),
        MIN_SCALE,
        MAX_SCALE,
      );
      const ratio = nextScale / start.transform.scale;
      setTransform({
        scale: nextScale,
        x: currentMidpoint.x - (start.midpoint.x - start.transform.x) * ratio,
        y: currentMidpoint.y - (start.midpoint.y - start.transform.y) * ratio,
      });
      return;
    }
    if (pointers.current.size === 1 && panStart.current && transform.scale > 1) {
      const start = panStart.current;
      setTransform({
        ...start.transform,
        x: start.transform.x + event.clientX - start.pointer.x,
        y: start.transform.y + event.clientY - start.pointer.y,
      });
    }
  };

  const finishViewportPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    panStart.current = null;
    pinchStart.current = null;
    if (pointers.current.size === 1) {
      const [pointer] = [...pointers.current.values()];
      panStart.current = { pointer, transform };
    }
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (mode === 'edit' || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const nextScale = clamp(transform.scale * Math.exp(-event.deltaY * 0.002), 1, 4);
    const ratio = nextScale / transform.scale;
    setTransform({
      scale: nextScale,
      x: anchor.x - (anchor.x - transform.x) * ratio,
      y: anchor.y - (anchor.y - transform.y) * ratio,
    });
  };

  const beginDraw = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mode !== 'edit' || event.button !== 0) return;
    const layer = editorLayerRef.current;
    if (!layer) return;
    const start = toPoint(event, layer);
    const regionId = makeRegionId();
    const draft: ManualRegionDraft = {
      region_id: regionId,
      label: '',
      x: start.x,
      y: start.y,
      width: 0,
      height: 0,
    };
    safeSetPointerCapture(event.currentTarget, event.pointerId);
    editorGesture.current = {
      type: 'draw',
      pointerId: event.pointerId,
      regionId,
      start,
      original: draft,
    };
    setDrafts((current) => [...current, draft]);
    setSelectedDraftId(regionId);
  };

  const beginEditGesture = (
    event: ReactPointerEvent<HTMLElement>,
    region: ManualRegionDraft,
    type: 'move' | 'resize',
  ) => {
    const layer = editorLayerRef.current;
    if (!layer) return;
    event.stopPropagation();
    safeSetPointerCapture(event.currentTarget, event.pointerId);
    editorGesture.current = {
      type,
      pointerId: event.pointerId,
      regionId: region.region_id,
      start: toPoint(event, layer),
      original: { ...region },
    };
    setSelectedDraftId(region.region_id);
  };

  const updateEditorGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = editorGesture.current;
    const layer = editorLayerRef.current;
    if (!gesture || !layer || gesture.pointerId !== event.pointerId) return;
    const point = toPoint(event, layer);
    const dx = point.x - gesture.start.x;
    const dy = point.y - gesture.start.y;
    setDrafts((current) =>
      current.map((region) => {
        if (region.region_id !== gesture.regionId) return region;
        if (gesture.type === 'draw') {
          return {
            ...region,
            x: Math.min(gesture.start.x, point.x),
            y: Math.min(gesture.start.y, point.y),
            width: Math.abs(point.x - gesture.start.x),
            height: Math.abs(point.y - gesture.start.y),
          };
        }
        if (gesture.type === 'move') {
          return {
            ...region,
            x: clamp(gesture.original.x + dx, 0, 1 - gesture.original.width),
            y: clamp(gesture.original.y + dy, 0, 1 - gesture.original.height),
          };
        }
        return {
          ...region,
          width: clamp(gesture.original.width + dx, 0.005, 1 - gesture.original.x),
          height: clamp(gesture.original.height + dy, 0.005, 1 - gesture.original.y),
        };
      }),
    );
  };

  const finishEditorGesture = () => {
    const gesture = editorGesture.current;
    if (!gesture) return;
    if (gesture.type === 'draw') {
      setDrafts((current) =>
        current.filter(
          (region) =>
            region.region_id !== gesture.regionId ||
            (region.width >= 0.005 && region.height >= 0.005),
        ),
      );
    }
    editorGesture.current = null;
  };

  const isLongImage = useMemo(() => {
    if (!currentSource) return false;
    return currentSource.height > currentSource.width * 1.4;
  }, [currentSource]);

  const fittedStageSize = useMemo(() => {
    if (!currentSource || viewportSize.width <= 0 || viewportSize.height <= 0) {
      return { width: currentSource?.width ?? 1, height: currentSource?.height ?? 1 };
    }
    const padding = 18;
    const availableWidth = Math.max(1, viewportSize.width - padding * 2);
    const availableHeight = Math.max(1, viewportSize.height - padding * 2);
    // Long images: fit WIDTH so text stays readable; the viewport scrolls
    // vertically (mouse wheel) to reveal the lower part. Normal images keep
    // the original whole-fit behavior.
    const scale = isLongImage
      ? availableWidth / currentSource.width
      : Math.min(
          availableWidth / currentSource.width,
          availableHeight / currentSource.height,
        );
    return {
      width: Math.max(1, Math.round(currentSource.width * scale)),
      height: Math.max(1, Math.round(currentSource.height * scale)),
    };
  }, [currentSource, viewportSize, isLongImage]);

  const selectedDraft = drafts.find((region) => region.region_id === selectedDraftId);
  const sourceList = sourceLibrary?.sources ?? [];
  const groupedStudySources = useMemo(() => {
    const groups = new Map<string, { fileId: string; fileName: string; sources: MindmapSource[] }>();
    for (const source of sourceList) {
      const fileId = sourceFileId(source);
      const group = groups.get(fileId) ?? { fileId, fileName: source.file_name || source.title, sources: [] };
      group.sources.push(source);
      groups.set(fileId, group);
    }
    return Array.from(groups.values()).map((group) => ({
      ...group,
      sources: [...group.sources].sort((a, b) => (a.page_number ?? 1) - (b.page_number ?? 1)),
    }));
  }, [sourceList]);
  const categoryScopeCounts = useMemo(() => {
    void runtimeIndexRevision;
    const runtime = runtimeIndexRef.current;
    const counts = new Map<string, number>();
    counts.set('all', runtime?.categoryKeys.get('all')?.size ?? studyIndex.length);
    for (const category of studyLibrary?.categories ?? []) {
      counts.set(category.category_id, runtime?.categoryKeys.get(category.category_id)?.size ?? 0);
    }
    return counts;
  }, [runtimeIndexRevision, studyIndex.length, studyLibrary]);
  const joinedPagesForActiveCategory = useMemo(() => {
    if (!studyLibrary) return [] as MindmapSource[];
    const ids = new Set(sourceIdsForCategory(studyLibrary, activeStudyCategoryId, sourceList));
    return sourceList.filter((source) => ids.has(source.source_id));
  }, [studyLibrary, activeStudyCategoryId, sourceList]);
  const primarySubjectCategories = useMemo(
    () => (studyLibrary?.categories ?? []).filter((category) => isPrimarySubjectCategory(category.category_id)),
    [studyLibrary],
  );
  const customStudyCategories = useMemo(
    () => (studyLibrary?.categories ?? []).filter((category) => !category.system),
    [studyLibrary],
  );
  const currentPrimarySubjectId = useMemo(
    () => currentSource && studyLibrary
      ? effectivePrimarySubjectId(studyLibrary, currentSource.source_id, sourceFileId(currentSource))
      : null,
    [studyLibrary, currentSource],
  );

  const focusedCategoryItem = useMemo(
    () => libraryFocusRegionId ? studyIndex.find((item) => item.regionId === libraryFocusRegionId && item.sourceId === currentSource?.source_id) ?? null : null,
    [libraryFocusRegionId, studyIndex, currentSource?.source_id],
  );
  const currentPageIndex = Math.max(
    0,
    sourceList.findIndex((source) => source.source_id === currentSource?.source_id),
  );
  const pageCount = sourceList.length;
  const goToPage = async (nextIndex: number) => {
    if (!sourceList.length) return;
    const clamped = clamp(nextIndex, 0, sourceList.length - 1);
    const source = sourceList[clamped];
    if (!source || source.source_id === currentSource?.source_id) return;
    await changeSource(source.source_id);
  };
  const boundCount = activeRegions.filter(
    (region) => region.binding_status === 'BOUND' && !!region.card_id,
  ).length;
  const unboundCount = Math.max(0, activeRegions.length - boundCount);
  const studyCounts = useMemo(() => {
    void runtimeIndexRevision;
    return countsFromRuntimeIndex(runtimeIndexRef.current, activeStudyCategoryId);
  }, [runtimeIndexRevision, activeStudyCategoryId]);
  const dueCount = studyCounts.due;
  const newCount = studyCounts.newCards;
  const completedSessionQueue = useMemo(() =>
    scopedStudyItems
      .filter((item) => !!item.cardId && sessionCompletedCardIds.has(item.cardId))
      .sort((left, right) => (right.latestReviewTime ?? 0) - (left.latestReviewTime ?? 0)),
    [scopedStudyItems, sessionCompletedCardIds],
  );
  const completedTodayCount = completedSessionQueue.length;
  const remainingTodayCount = studyCounts.remaining;
  const unknownCount = Object.values(schedule).filter(
    (item) => item.state === 'UNKNOWN' || item.state === 'UNMAPPED',
  ).length;
  const verifiedNativeCount = Object.values(schedule).filter(
    (item) => !!item.cardId && !!item.remId && item.state !== 'UNKNOWN' && item.state !== 'UNMAPPED',
  ).length;
  const nativeSyncLabel = lastNativeSyncAt
    ? new Date(lastNativeSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;
  const scopedStudyKeys = useMemo(() => new Set(scopedStudyItems.map((item) => item.key)), [scopedStudyItems]);
  const matchesReviewFilter = (regionId: string) => {
    if (!currentSource) return false;
    const key = `${currentSource.source_id}:${regionId}`;
    if (!scopedStudyKeys.has(key)) return false;
    const item = schedule[regionId];
    if (!item) return false;
    if (reviewFilter === 'DUE') return item.state === 'DUE';
    if (reviewFilter === 'NEW') return item.state === 'NEW';
    if (reviewFilter === 'COMPLETED') return item.reviewedToday;
    return item.state === 'DUE' || item.state === 'NEW';
  };
  const globalReviewQueue = useMemo(() => {
    void runtimeIndexRevision;
    if (reviewFilter === 'COMPLETED') return completedSessionQueue;
    return queueFromRuntimeIndex(runtimeIndexRef.current, activeStudyCategoryId, reviewFilter);
  }, [runtimeIndexRevision, activeStudyCategoryId, reviewFilter, completedSessionQueue]);
  const currentQueueIndex = activeRegionId && currentSource
    ? globalReviewQueue.findIndex(
        (item) => item.sourceId === currentSource.source_id && item.regionId === activeRegionId,
      )
    : -1;

  const navigateToStudyItem = async (item: StudyReviewItem, lookupMs = 0, traceFilter: ReviewFilter = reviewFilter) => {
    const navStarted = performance.now();
    const trace: NavigationAudit = {
      started_at: new Date().toISOString(),
      category_id: activeStudyCategoryId,
      filter: traceFilter,
      target: { file_id: item.fileId, source_id: item.sourceId, region_id: item.regionId, card_id: item.cardId },
      stages: [
        { stage: 'NAV_START', elapsed_ms: 0 },
        { stage: 'INDEX_LOOKUP', elapsed_ms: lookupMs },
      ],
    };
    const mark = (stage: NavigationAudit['stages'][number]['stage']) => {
      trace.stages.push({ stage, elapsed_ms: Math.round((performance.now() - navStarted) * 10) / 10 });
    };

    setMode('review');
    // Never auto-reset zoom on rating navigation (same page or cross-page).
    // The user zooms once to read comfortably; resetting forces them to
    // re-zoom for every card. Zoom only resets on explicit user actions:
    // the fit (%) button, the page navigator, or mode switches.
    if (item.sourceId !== currentSource?.source_id) {
      const fileChanged = item.fileId !== (currentSource ? sourceFileId(currentSource) : null);
      await loadRegions(item.sourceId, { preserveFilter: true, targetRegionId: item.regionId });
      if (fileChanged) mark('FILE_SWITCH');
      mark('PAGE_SWITCH');
    } else {
      resetForRegions(regionIds);
      activeRegionIdRef.current = item.regionId;
      setActiveRegionId(item.regionId);
    }
    mark('CARD_LOCATE');
    setQueuePulseRegionId(item.regionId);
    window.setTimeout(() => {
      setQueuePulseRegionId((current) => (current === item.regionId ? null : current));
    }, 900);
    const elapsed = Math.round((performance.now() - navStarted) * 10) / 10;
    setSourceMessage(`已定位：${item.sourceTitle} · ${item.regionLabel}`);
    window.requestAnimationFrame(() => {
      mark('RENDER_DONE');
      void plugin.storage.setSession(NAVIGATION_AUDIT_SESSION_KEY, trace);
    });
  };

  const navigateToCard = async (
    cardId: string,
    preferredItem: StudyReviewItem | null,
    lookupMs = 0,
    traceFilter: ReviewFilter = reviewFilter,
  ) => {
    const runtime = runtimeIndexRef.current;
    if (!runtime) {
      setSourceMessage('学习范围正在准备，请稍后再点一次。');
      return;
    }
    const scopeKeys = runtime.categoryKeys.get(activeStudyCategoryId) ?? new Set<string>();
    let target = preferredItem?.cardId === cardId && scopeKeys.has(preferredItem.key) ? preferredItem : null;
    if (!target) {
      const keys = runtime.keysByCardId.get(cardId);
      if (keys) {
        for (const key of keys) {
          if (!scopeKeys.has(key)) continue;
          const item = runtime.itemsByKey.get(key);
          if (item) { target = item; break; }
        }
      }
    }
    if (!target) {
      setSourceMessage('当前分类中找不到这张卡的位置。');
      return;
    }
    await navigateToStudyItem(target, lookupMs, traceFilter);
  };

  const restartReviewFilter = async (
    requestedFilter: ReviewFilter,
    afterScore = false,
    indexOverride?: readonly StudyReviewItem[],
  ) => {
    setMoreOpen(false);
    setSidePanel(null);
    setLibraryFocusRegionId(null);
    setCategoryPagePickerOpen(false);
    setCategoryPreciseOpen(false);
    setMode('review');

    const existingSession = reviewSessionRef.current;
    const nextFilter = afterScore && existingSession ? existingSession.filter : requestedFilter;
    const scopeId = afterScore && existingSession ? existingSession.scopeId : activeStudyCategoryId;
    setReviewFilter(nextFilter);
    if (!afterScore) resetForRegions(regionIds);

    const categoryName = scopeId === 'all'
      ? '全部'
      : studyLibrary?.categories.find((item) => item.category_id === scopeId)?.name ?? '当前分类';
    if (!studyIndexReady || studyIndexLoading) {
      setSourceMessage('学习范围正在准备，请稍后再点一次。');
      return;
    }
    const lookupStarted = performance.now();
    if (indexOverride && runtimeIndexRef.current) void indexOverride;
    const nextQueue = queueFromRuntimeIndex(runtimeIndexRef.current, scopeId, nextFilter);
    const lookupMs = Math.round((performance.now() - lookupStarted) * 10) / 10;
    const first = nextQueue[0] ?? null;
    const nextPosition = afterScore && existingSession ? existingSession.position + 1 : 0;

    if (!first) {
      activeRegionIdRef.current = null;
      setActiveRegionId(null);
      reviewSessionRef.current = {
        scopeId,
        filter: nextFilter,
        queueCardIds: [],
        currentCardId: null,
        position: nextPosition,
        startedAt: existingSession?.startedAt ?? new Date().toISOString(),
      };
      const label = nextFilter === 'DUE' ? '到期' : nextFilter === 'NEW' ? '新卡' : nextFilter === 'COMPLETED' ? '完成' : '剩余';
      setSourceMessage(
        nextFilter === 'COMPLETED'
          ? `“${categoryName}”本次会话暂无已完成项目。`
          : `“${categoryName}”本轮${label}复习已完成。`,
      );
      return;
    }
    if (!first.cardId) {
      setSourceMessage('目标学习项尚未绑定原生卡，已停止导航。');
      return;
    }

    reviewSessionRef.current = {
      scopeId,
      filter: nextFilter,
      queueCardIds: nextQueue.map((item) => item.cardId).filter((cardId): cardId is string => !!cardId),
      currentCardId: first.cardId,
      position: nextPosition,
      startedAt: afterScore && existingSession ? existingSession.startedAt : new Date().toISOString(),
    };
    // Direct navigation: `first` is already a valid StudyReviewItem from the
    // correct scope's queue. Bypass navigateToCard's key lookup, which can
    // silently fail when the runtime index is inconsistent, leaving the UI
    // stuck in "preparing next question" with no active region.
    await navigateToStudyItem(first, lookupMs, nextFilter);
    const label = nextFilter === 'DUE' ? '到期' : nextFilter === 'NEW' ? '新卡' : nextFilter === 'COMPLETED' ? '完成' : '剩余';
    if (!afterScore) {
      // Show which pages the cards are on, so the user can manually navigate
      // if auto-navigation fails (e.g. corrupt index entries from pre-patch-9 imports).
      const pages = [...new Set(nextQueue.map((item) => item.sourceTitle).filter(Boolean))];
      const pageInfo = pages.length ? `（位于：${pages.join('、')}）` : '';
      setSourceMessage(`已进入“${categoryName}”${label}连续复习 · ${nextQueue.length} 张${pageInfo}`);
    }
  };

  const selectStudyCategory = async (categoryId: string) => {
    if (!studyLibrary) return;
    const updated = await setActiveStudyCategory(plugin, studyLibrary, categoryId);
    setStudyLibrary(updated);
    setCategoryPagePickerOpen(false);
    setCategoryPreciseOpen(false);
    setReviewFilter('REMAINING');
    reviewSessionRef.current = null;
    resetForRegions(regionIds);
    const selectedName = categoryId === 'all'
      ? '全部'
      : updated.categories.find((item) => item.category_id === categoryId)?.name ?? '当前分类';
    setSourceMessage(`当前分类：${selectedName}`);
  };

  const setCurrentPagePrimarySubject = async (categoryId: string) => {
    if (!studyLibrary || !currentSource || !isPrimarySubjectCategory(categoryId)) return;
    const updated = await setPrimarySubjectForTarget(plugin, studyLibrary, 'page', currentSource.source_id, categoryId);
    setStudyLibrary(updated);
    installRuntimeIndex(studyIndex, updated);
    const subjectName = updated.categories.find((item) => item.category_id === categoryId)?.name ?? '主学科';
    setSourceMessage(`主学科已移动到“${subjectName}”；旧主学科关系已退出当前页面。`);
  };

  const toggleCategoryTarget = async (
    categoryId: string,
    targetType: CategoryTargetType,
    targetId: string,
    included: boolean,
  ) => {
    if (!studyLibrary || categoryId === 'all' || categoryId === 'tcm-all') return;
    const updated = await setCategoryTargetMembership(plugin, studyLibrary, categoryId, targetType, targetId, included);
    setStudyLibrary(updated);
    installRuntimeIndex(studyIndex, updated);
    setSourceMessage('分类已保存；不会修改原始内容或 RN 调度。');
  };

  const toggleSourceInActiveCategory = async (sourceId: string, included: boolean) => {
    if (!studyLibrary || activeStudyCategoryId === 'all' || activeStudyCategoryId === 'tcm-all') return;
    const updated = await setSourceCategoryMembership(plugin, studyLibrary, activeStudyCategoryId, sourceId, included);
    setStudyLibrary(updated);
    installRuntimeIndex(studyIndex, updated);
    setSourceMessage('页面分类已更新。');
  };

  const createCustomStudyCategory = async () => {
    if (!studyLibrary || !newCategoryName.trim()) return;
    const name = newCategoryName.trim();
    const updated = await addCustomStudyCategory(plugin, studyLibrary, name);
    setStudyLibrary(updated);
    installRuntimeIndex(studyIndex, updated);
    setNewCategoryName('');
    setReviewFilter('REMAINING');
    setSourceMessage(`已建立分类“${name}”；现在可以直接勾选页面加入。`);
  };

  const renameActiveCustomCategory = async () => {
    if (!studyLibrary || !activeStudyCategory || activeStudyCategory.system) return;
    const name = window.prompt('修改分类名称', activeStudyCategory.name);
    if (!name?.trim()) return;
    const updated = await renameStudyCategory(plugin, studyLibrary, activeStudyCategory.category_id, name);
    setStudyLibrary(updated);
    setSourceMessage(`分类已重命名为“${name.trim()}”。`);
  };

  const deleteActiveCustomCategory = async () => {
    if (!studyLibrary || !activeStudyCategory || activeStudyCategory.system) return;
    if (!window.confirm(`删除分类“${activeStudyCategory.name}”？\n\n只删除分类关系，不删除任何页面、遮挡、Rem 或 RN Card。`)) return;
    const updated = await deleteStudyCategory(plugin, studyLibrary, activeStudyCategory.category_id);
    setStudyLibrary(updated);
    installRuntimeIndex(studyIndex, updated);
    setLibraryFocusRegionId(null);
    setSourceMessage('分类已删除；原知识内容和 RN Card 完全保留。');
  };

  advanceAfterScoreRef.current = async (indexOverride) => {
    const session = reviewSessionRef.current;
    await restartReviewFilter(session?.filter ?? reviewFilter, true, indexOverride);
  };

  const activeSchedule = activeRegionId ? schedule[activeRegionId] : undefined;
  const activeRating = activeRegionId ? ratings[activeRegionId] : undefined;
  const activeUnknownOutcomeLocked =
    !!activeSchedule?.cardId && unknownOutcomeCardIds.current.has(activeSchedule.cardId);
  const ratingAllowed =
    mode === 'review' &&
    reviewFilter !== 'COMPLETED' &&
    !!activeRegionId &&
    !!activeSchedule?.cardId &&
    !!activeSchedule.remId &&
    !activeUnknownOutcomeLocked &&
    canSubmitNativeScore(
      'review',
      regionState[activeRegionId],
      activeSchedule.state,
      activeRating?.state ?? 'IDLE',
    );
  const ratingDisabledReason = activeUnknownOutcomeLocked
    ? '上次评分结果不明确；本次会话已锁定这张卡，重新打开 Viewer 后再核对。'
    : ratingBlockReason(
        mode,
        activeRegionId,
        regionState,
        activeSchedule,
        activeRating,
      );
  const activeScoreLabel =
    activeRating?.state === 'DONE' && activeRating.nextRepetitionTime
      ? formatIntervalFromNow(activeRating.nextRepetitionTime)
      : null;
  const activeRegion = activeRegionId
    ? activeRegions.find((item) => item.region_id === activeRegionId) ?? null
    : null;
  const rnIntervalPreviewDiagnostic = 'RemNote Plugin SDK 0.0.46 未公开 Again / Hard / Good / Easy 四档评分前预测间隔 API；这里不模拟、不硬编码。评分后只显示 RN Native Card 实际 nextRepetitionTime。';

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (mode !== 'review' || !activeRegionId) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

      // Anki-style reveal step: Space shows the answer; numeric keys only rate
      // after reveal and only when RN says this Native Card is scoreable.
      if ((event.key === ' ' || event.code === 'Space') && regionState[activeRegionId] !== 'REVEALED') {
        event.preventDefault();
        void reveal(activeRegionId);
        return;
      }
      if (!ratingAllowed) return;
      const choice = scoreButtons.find((item) => item.key === event.key);
      if (!choice) return;
      event.preventDefault();
      void submitScore(activeRegionId, choice.score);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeRegionId, mode, ratingAllowed, schedule, ratings, regionState]);

  return (
    <main
      className={`mindmap-review-shell mode-${mode} ${mode === 'review' && activeRegionId && regionState[activeRegionId] !== 'REVEALED' ? 'question-phase' : ''}`}
      data-build-id={MANUAL_REGION_BUILD_ID}
    >
      {pdfPageDialog ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="选择 PDF 页面"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(15, 23, 42, 0.45)',
          }}
          onClick={cancelPdfPageDialog}
        >
          <div
            style={{
              width: 'min(420px, 90vw)',
              backgroundColor: '#ffffff',
              borderRadius: 12,
              padding: '20px 22px',
              boxShadow: '0 12px 40px rgba(15, 23, 42, 0.25)',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>选择 PDF 页面</h3>
            <p style={{ margin: '0 0 4px', fontSize: 13, color: '#334155' }}>
              {pdfPageDialog.fileName} 共 {pdfPageDialog.pageCount} 页。
            </p>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#64748b' }}>
              留空=导入全部；也可输入 1-3,5,8。
            </p>
            <input
              autoFocus
              value={pdfPageInput}
              onChange={(event) => setPdfPageInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') confirmPdfPageDialog();
                if (event.key === 'Escape') cancelPdfPageDialog();
              }}
              placeholder="例如：1-3,5"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                fontSize: 14,
                padding: '8px 10px',
                border: '1px solid #cbd5e1',
                borderRadius: 8,
                marginBottom: 14,
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={cancelPdfPageDialog}
                style={{
                  fontSize: 14,
                  padding: '8px 18px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmPdfPageDialog}
                style={{
                  fontSize: 14,
                  padding: '8px 18px',
                  borderRadius: 8,
                  border: 'none',
                  backgroundColor: '#4f46e5',
                  color: '#ffffff',
                  cursor: 'pointer',
                }}
              >
                导入
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <header className="review-toolbar" aria-label="复习控制">
        <div className="toolbar-left">
          <button className="toolbar-button return-button" type="button" onClick={() => void returnToRemNote()}>
            ← 返回
          </button>
          <div className="mode-segment" role="group" aria-label="复习模式">
            <button
              className={`mode-button ${mode === 'review' ? 'active' : ''}`}
              type="button"
              aria-pressed={mode === 'review'}
              title="从 RN Native Card 读取 DUE + NEW，按 RN FSRS 真实评分"
              onClick={() => void restartReviewFilter('REMAINING')}
            >
              今日复习
            </button>
            <button
              className={`mode-button ${mode === 'free' ? 'active' : ''}`}
              type="button"
              aria-pressed={mode === 'free'}
              title="只做遮挡回忆，不写入 RN 调度"
              onClick={() => switchMode('free')}
            >
              自由背诵
            </button>
            <button
              className={`mode-button ${mode === 'edit' ? 'active' : ''}`}
              type="button"
              aria-pressed={mode === 'edit'}
              title="编辑手工遮挡区域；保存时显式绑定 RN Native Card"
              onClick={enterEditor}
            >
              遮挡编辑
            </button>
          </div>
          <button className={`toolbar-button library-button ${sidePanel === 'library' ? 'active' : ''}`} type="button" onClick={openStudyLibraryPanel}>
            分类
          </button>
        </div>

        <div className="page-nav" aria-label="脑图翻页">
          <button
            className="page-arrow"
            type="button"
            aria-label="上一页"
            disabled={currentPageIndex <= 0}
            onClick={() => void goToPage(currentPageIndex - 1)}
          >
            ‹
          </button>
          <div style={{ position: 'relative' }}>
            <div
              className="page-meta"
              role="button"
              tabIndex={0}
              aria-expanded={pageListOpen}
              aria-label="页面目录，点击展开或收起"
              title="点击展开页面目录"
              onClick={() => setPageListOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setPageListOpen((open) => !open);
                }
              }}
              style={{ cursor: 'pointer' }}
            >
              <strong>{pageCount ? `${currentPageIndex + 1} / ${pageCount}` : '0 / 0'}</strong>
              <span>{currentSource?.title ?? '未选择脑图'}</span>
            </div>
            {pageListOpen ? (
              <div
                role="listbox"
                aria-label="页面目录"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 50,
                  minWidth: 220,
                  maxWidth: 320,
                  maxHeight: 320,
                  overflowY: 'auto',
                  backgroundColor: '#ffffff',
                  borderRadius: 12,
                  boxShadow: '0 8px 32px rgba(15, 23, 42, 0.18)',
                  border: '1px solid rgba(15, 23, 42, 0.08)',
                  padding: 6,
                }}
              >
                {sourceList.map((source, index) => {
                  const isCurrent = index === currentPageIndex;
                  const isRenaming = renamingSourceId === source.source_id;
                  return (
                    <div
                      key={source.source_id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: 8,
                        backgroundColor: isCurrent ? '#eef2ff' : 'transparent',
                      }}
                    >
                      <span style={{ minWidth: 40, fontWeight: 600, flexShrink: 0, fontSize: 13, color: isCurrent ? '#1e293b' : '#475569' }}>
                        {index + 1} / {pageCount}
                      </span>
                      {isRenaming ? (
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === 'Enter') {
                              void renameSource(source.source_id, renameValue);
                            } else if (event.key === 'Escape') {
                              setRenamingSourceId(null);
                            }
                          }}
                          onBlur={() => {
                            void renameSource(source.source_id, renameValue);
                          }}
                          onClick={(event) => event.stopPropagation()}
                          onDoubleClick={(event) => event.stopPropagation()}
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                          style={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: 13,
                            padding: '4px 8px',
                            borderRadius: 6,
                            border: '1px solid #6366f1',
                            outline: 'none',
                            color: '#1e293b',
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          title="单击跳转，双击重命名"
                          onClick={() => {
                            if (pageClickTimer.current) return;
                            pageClickTimer.current = window.setTimeout(() => {
                              pageClickTimer.current = null;
                              setPageListOpen(false);
                              void goToPage(index);
                            }, 250);
                          }}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            if (pageClickTimer.current) {
                              clearTimeout(pageClickTimer.current);
                              pageClickTimer.current = null;
                            }
                            setRenameValue(source.title);
                            setRenamingSourceId(source.source_id);
                          }}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            border: 'none',
                            backgroundColor: 'transparent',
                            padding: 0,
                            fontSize: 13,
                            textAlign: 'left',
                            cursor: 'pointer',
                            color: isCurrent ? '#1e293b' : '#475569',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {source.title}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
          <button
            className="page-arrow"
            type="button"
            aria-label="下一页"
            disabled={!pageCount || currentPageIndex >= pageCount - 1}
            onClick={() => void goToPage(currentPageIndex + 1)}
          >
            ›
          </button>
        </div>

        <div className="toolbar-right">
          {mode === 'edit' ? (
            <>
              <button className="toolbar-button primary" type="button" onClick={() => void saveEditor()}>
                {saveState === 'SAVING' ? '保存中…' : '保存并绑定'}
              </button>
              <button className="toolbar-button" type="button" onClick={cancelEditor}>取消</button>
            </>
          ) : (
            <>
              <button className="toolbar-button" type="button" onClick={() => fileInputRef.current?.click()}>
                加入页面
              </button>
              <button
                className="toolbar-button delete-page-button"
                type="button"
                disabled={!currentSource}
                onClick={() => void deleteCurrentPage()}
                title="只从 Mindmap 页面列表移除当前页；不会删除 Rem / Native Card / FSRS 数据"
              >
                删除本页
              </button>
            </>
          )}
          <input
            ref={fileInputRef}
            className="hidden-file-input"
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/svg+xml,application/pdf,.pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif,.svg"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = '';
              void importImages(files);
            }}
          />
          <button className="toolbar-button" type="button" title="重置缩放与拖动，并按当前 RN 工作区重新等比例铺满整张导图" onClick={fitView}>适应屏幕</button>
          <button className="toolbar-button" type="button" title="只把当前页面答案重新盖住；不改 RN 调度" onClick={reset}>重新遮挡</button>
          <div className="more-wrap">
            <button
              className={`toolbar-button rn-button ${moreOpen ? 'active' : ''}`}
              type="button"
              aria-expanded={moreOpen}
              title="RN 原生状态、绑定修复与显式解绑操作"
              onClick={() => setMoreOpen((current) => !current)}
            >
              RemNote
            </button>
            {moreOpen ? (
              <div className="more-menu" role="menu">
                {unboundCount > 0 ? (
                  <button type="button" onClick={() => void repairBindings()}>修复绑定 {unboundCount}</button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    setSourceMessage('正在刷新 RN 调度…');
                    void Promise.all([refreshNativeState(activeRegions), rebuildGlobalStudyIndex()]).then(() => {
                      setSourceMessage('RN 调度与当前学习池索引已刷新');
                    });
                  }}
                >
                  刷新 RN 调度
                </button>
                <button type="button" onClick={openCardsPanel}>本页卡片状态</button>
                <button
                  type="button"
                  className="danger-menu-item"
                  disabled={!activeRegions.length || saveState === 'SAVING'}
                  onClick={() => void clearAllBindingsAndOcclusions()}
                  title="清空全部页面旧 Region 遮挡和绑定；保留原 Rem / Native Card / repetitionHistory / FSRS 历史"
                >
                  清空全部绑定与遮挡
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="schedule-notice global-study-controller" aria-label="全局学习控制器">
        <div className="today-summary" aria-label="全局学习状态与导航">
          <span className="study-scope-label" title="当前分类决定顶部统计和四个导航队列的学习范围">
            当前分类：{activeStudyCategoryId === 'all' ? '全部' : activeStudyCategory?.name ?? '当前分类'}
            {studyIndexLoading ? ' · 准备中' : ''}
          </span>
          <button className={`summary-chip chip-due ${mode === 'review' && reviewFilter === 'DUE' ? 'active' : ''}`} type="button" disabled={!studyIndexReady || studyIndexLoading} aria-pressed={mode === 'review' && reviewFilter === 'DUE'} title="进入当前分类下一张真实到期卡" onClick={() => void restartReviewFilter('DUE')}><b>{dueCount}</b> 到期</button>
          <button className={`summary-chip chip-new ${mode === 'review' && reviewFilter === 'NEW' ? 'active' : ''}`} type="button" disabled={!studyIndexReady || studyIndexLoading} aria-pressed={mode === 'review' && reviewFilter === 'NEW'} title="进入当前分类下一张真实新卡" onClick={() => void restartReviewFilter('NEW')}><b>{newCount}</b> 新卡</button>
          <button className={`summary-chip chip-completed ${mode === 'review' && reviewFilter === 'COMPLETED' ? 'active' : ''}`} type="button" disabled={!studyIndexReady || studyIndexLoading} aria-pressed={mode === 'review' && reviewFilter === 'COMPLETED'} title="查看当前分类本次会话已完成卡；不会再次写 RN 调度" onClick={() => void restartReviewFilter('COMPLETED')}><b>{completedTodayCount}</b> 完成</button>
          <button className={`summary-chip chip-remaining ${mode === 'review' && reviewFilter === 'REMAINING' ? 'active' : ''}`} type="button" disabled={!studyIndexReady || studyIndexLoading} aria-pressed={mode === 'review' && reviewFilter === 'REMAINING'} title="进入当前分类下一张尚未完成的 DUE / NEW 卡" onClick={() => void restartReviewFilter('REMAINING')}><b>{remainingTodayCount}</b> 剩余</button>
          {mode === 'review' && reviewFilter !== 'COMPLETED' && globalReviewQueue.length > 0 ? (
            <span className="queue-progress">队列 {Math.max(1, currentQueueIndex + 1)} / {globalReviewQueue.length}</span>
          ) : null}
          {completedTodayCount > 0 && remainingTodayCount === 0 ? <strong>今日完成</strong> : null}
        </div>
        <div className="rn-native-status">
          {sourceMessage ? <span className="source-message" title={sourceMessage}>{sourceMessage}</span> : null}
          {mode === 'free' ? <span>自由背诵 · 不写 RN 调度</span> : null}
          {mode === 'edit' ? <span>遮挡编辑 · 四个学习导航仍可直接进入 Review</span> : null}
          {mode === 'review' ? <span>RN Native Card 已校验 {verifiedNativeCount}/{boundCount}</span> : null}
          {nativeSyncLabel ? <span>最近回读 {nativeSyncLabel}</span> : null}
          {activeSchedule?.cardId && mode === 'review' ? (
            <span>当前 RN {stateLabels[activeSchedule.state]}</span>
          ) : null}
          {mode === 'review' && activeRegionId && regionState[activeRegionId] !== 'REVEALED' ? (
            <span className="review-step-hint">当前题：单击遮挡显示答案 · 再单击重新遮挡</span>
          ) : null}
          {unknownCount > 0 && mode === 'review' ? <span>待确认 {unknownCount}</span> : null}
        </div>
      </div>

      {sidePanel === 'cards' ? (
        <aside className="rn-side-panel" aria-label="本页 RemNote 卡片状态">
          <div className="rn-side-panel-head">
            <div>
              <strong>本页卡片状态</strong>
              <span>只读 Native Card 调度，不创建第二套算法</span>
            </div>
            <button type="button" aria-label="关闭侧栏" onClick={() => setSidePanel(null)}>×</button>
          </div>
          <div className="rn-side-panel-body card-status-list">
            {activeRegions.length ? activeRegions.map((region, index) => {
              const item = schedule[region.region_id];
              return (
                <button
                  type="button"
                  key={region.region_id}
                  onClick={() => { setSidePanel(null); activeRegionIdRef.current = region.region_id; setActiveRegionId(region.region_id); }}
                >
                  <span>{region.label || `区域 ${index + 1}`}</span>
                  <b>{stateLabels[item?.state ?? 'UNMAPPED']}</b>
                </button>
              );
            }) : <p className="side-note">当前页面还没有手工遮挡区域。</p>}
          </div>
        </aside>
      ) : null}

      {sidePanel === 'library' ? (
        <aside className="rn-side-panel study-library-panel" aria-label="学习分类">
          <div className="rn-side-panel-head">
            <div>
              <strong>学习分类</strong>
              <span>选择分类 → 勾页面 → 完成；分类只改变学习范围，不修改 RN 数据</span>
            </div>
            <button type="button" aria-label="关闭分类" onClick={() => { setSidePanel(null); setLibraryFocusRegionId(null); setCategoryPagePickerOpen(false); setCategoryPreciseOpen(false); }}>×</button>
          </div>
          <div className="rn-side-panel-body study-library-body simplified-study-library">
            <div className="study-category-list">
              <button
                type="button"
                className={activeStudyCategoryId === 'all' ? 'active' : ''}
                onClick={() => void selectStudyCategory('all')}
              >
                <span>全部</span><b>{categoryScopeCounts.get('all') ?? studyIndex.length}</b>
              </button>
              <div className="study-library-section">中医综合</div>
              {(studyLibrary?.categories ?? []).filter((item) => item.parent_id === 'tcm' && item.category_id !== 'tcm-all').map((category) => (
                <button
                  type="button"
                  key={category.category_id}
                  className={activeStudyCategoryId === category.category_id ? 'active' : ''}
                  onClick={() => void selectStudyCategory(category.category_id)}
                >
                  <span>{category.name}</span><b>{categoryScopeCounts.get(category.category_id) ?? 0}</b>
                </button>
              ))}
              <div className="study-library-section">其他</div>
              {(studyLibrary?.categories ?? []).filter((item) => item.parent_id !== 'tcm' && item.system).map((category) => (
                <button
                  type="button"
                  key={category.category_id}
                  className={activeStudyCategoryId === category.category_id ? 'active' : ''}
                  onClick={() => void selectStudyCategory(category.category_id)}
                >
                  <span>{category.name}</span><b>{categoryScopeCounts.get(category.category_id) ?? 0}</b>
                </button>
              ))}
              <div className="study-library-section">我的分类</div>
              {(studyLibrary?.categories ?? []).filter((item) => !item.system).map((category) => (
                <button
                  type="button"
                  key={category.category_id}
                  className={activeStudyCategoryId === category.category_id ? 'active' : ''}
                  onClick={() => void selectStudyCategory(category.category_id)}
                >
                  <span>{category.name}</span><b>{categoryScopeCounts.get(category.category_id) ?? 0}</b>
                </button>
              ))}
              <div className="study-category-create-row">
                <input
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.currentTarget.value)}
                  placeholder="新建分类，例如：泻下药"
                  aria-label="自定义分类名称"
                />
                <button type="button" className="add-category-button" disabled={!newCategoryName.trim()} onClick={() => void createCustomStudyCategory()}>＋ 新建</button>
              </div>
            </div>

            <div className="study-source-membership simple-study-membership">
              <section className="simple-classify-card current-page-classify">
                <div className="simple-classify-head">
                  <div>
                    <strong>当前页面分类</strong>
                    <span>{currentSource?.title ?? '当前没有页面'} · 主学科单选，专题可多选</span>
                  </div>
                </div>

                <div className="classification-subsection">
                  <div className="classification-subtitle">主学科</div>
                  <div className="simple-category-checks primary-subject-checks" role="radiogroup" aria-label="当前页面主学科">
                    {primarySubjectCategories.map((category) => {
                      if (!currentSource) return null;
                      const included = currentPrimarySubjectId === category.category_id;
                      return (
                        <label key={category.category_id} className={included ? 'included primary-selected' : ''}>
                          <input
                            type="radio"
                            name="current-page-primary-subject"
                            checked={included}
                            onChange={() => void setCurrentPagePrimarySubject(category.category_id)}
                          />
                          <span>{category.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="classification-subsection">
                  <div className="classification-subtitle">我的分类</div>
                  {customStudyCategories.length ? (
                    <div className="simple-category-checks custom-category-checks">
                      {customStudyCategories.map((category) => {
                        if (!currentSource) return null;
                        const inheritedByFile = targetMembership(studyLibrary, category.category_id, 'file', sourceFileId(currentSource));
                        const directPage = targetMembership(studyLibrary, category.category_id, 'page', currentSource.source_id);
                        const included = inheritedByFile || directPage;
                        return (
                          <label key={category.category_id} className={included ? 'included' : ''} title={inheritedByFile ? '该页由整份内容关系包含' : undefined}>
                            <input
                              type="checkbox"
                              checked={included}
                              disabled={inheritedByFile}
                              onChange={(event) => void toggleCategoryTarget(category.category_id, 'page', currentSource.source_id, event.currentTarget.checked)}
                            />
                            <span>{category.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : <p className="simple-empty-note">还没有自定义分类，可在左侧“我的分类”下新建。</p>}
                </div>
              </section>

              <section className="simple-classify-card category-content-card">
                <div className="simple-classify-head">
                  <div>
                    <strong>{activeStudyCategoryId === 'all' ? '选择一个分类' : activeStudyCategory?.name ?? '当前分类'}</strong>
                    <span>{activeStudyCategoryId === 'all' ? '选择左侧分类后即可查看和添加页面' : `已加入页面 ${joinedPagesForActiveCategory.length} 个`}</span>
                  </div>
                  {activeStudyCategory && !activeStudyCategory.system ? (
                    <span className="category-actions">
                      <button type="button" onClick={() => void renameActiveCustomCategory()}>重命名</button>
                      <button type="button" className="danger-text" onClick={() => void deleteActiveCustomCategory()}>删除</button>
                    </span>
                  ) : null}
                </div>

                {activeStudyCategoryId !== 'all' ? (
                  <>
                    <div className="joined-page-list">
                      {joinedPagesForActiveCategory.length ? joinedPagesForActiveCategory.map((source) => {
                        const inheritedByFile = targetMembership(studyLibrary, activeStudyCategoryId, 'file', sourceFileId(source));
                        return (
                          <label key={source.source_id} className="included">
                            <input
                              type="checkbox"
                              checked
                              disabled={activeStudyCategoryId === 'tcm-all' || inheritedByFile}
                              onChange={(event) => void toggleSourceInActiveCategory(source.source_id, event.currentTarget.checked)}
                            />
                            <span>{source.file_name ? `${source.file_name} · ` : ''}{source.page_number ? `第 ${source.page_number} 页` : source.title}</span>
                          </label>
                        );
                      }) : <p className="simple-empty-note">还没有加入页面。点“＋ 添加内容”即可。</p>}
                    </div>
                    {activeStudyCategoryId !== 'tcm-all' ? (
                      <button type="button" className="simple-add-content" onClick={() => setCategoryPagePickerOpen((current) => !current)}>
                        {categoryPagePickerOpen ? '收起页面选择' : '＋ 添加内容'}
                      </button>
                    ) : null}
                    {categoryPagePickerOpen && activeStudyCategoryId !== 'tcm-all' ? (
                      <div className="simple-page-picker" aria-label="页面选择器">
                        {groupedStudySources.map((group) => (
                          <div className="simple-page-picker-group" key={group.fileId}>
                            <strong>{group.fileName}</strong>
                            <div>
                              {group.sources.map((source) => {
                                const inheritedByFile = targetMembership(studyLibrary, activeStudyCategoryId, 'file', group.fileId);
                                const included = inheritedByFile || targetMembership(studyLibrary, activeStudyCategoryId, 'page', source.source_id);
                                return (
                                  <label key={source.source_id} className={included ? 'included' : ''}>
                                    <input
                                      type="checkbox"
                                      checked={included}
                                      disabled={inheritedByFile}
                                      onChange={(event) => void toggleSourceInActiveCategory(source.source_id, event.currentTarget.checked)}
                                    />
                                    <span>{source.page_number ? `第 ${source.page_number} 页` : source.title}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : <p className="simple-empty-note">“全部”自动覆盖所有已索引卡片；选择左侧具体分类即可管理内容。</p>}
              </section>

              {activeStudyCategoryId !== 'all' && activeStudyCategoryId !== 'tcm-all' && currentSource && activeStudyCategory && !activeStudyCategory.system ? (
                <section className="simple-classify-card precise-classify-card">
                  <button type="button" className="precise-toggle" onClick={() => setCategoryPreciseOpen((current) => !current)}>
                    精确到遮挡 {categoryPreciseOpen ? '−' : '＋'}
                  </button>
                  {categoryPreciseOpen ? (
                    <div className="precise-mask-list">
                      {activeRegions.map((region, index) => {
                        const indexed = studyIndex.find((item) => item.sourceId === currentSource.source_id && item.regionId === region.region_id) ?? null;
                        const targetType: CategoryTargetType = indexed?.cardId ? 'card' : 'mask';
                        const targetId = indexed?.cardId ?? region.region_id;
                        const pageIncluded = targetMembership(studyLibrary, activeStudyCategoryId, 'page', currentSource.source_id) || targetMembership(studyLibrary, activeStudyCategoryId, 'file', sourceFileId(currentSource));
                        const included = pageIncluded || targetMembership(studyLibrary, activeStudyCategoryId, targetType, targetId);
                        return (
                          <label key={region.region_id} className={included ? 'included' : ''}>
                            <input
                              type="checkbox"
                              checked={included}
                              disabled={pageIncluded}
                              onChange={(event) => void toggleCategoryTarget(activeStudyCategoryId, targetType, targetId, event.currentTarget.checked)}
                            />
                            <span>{region.label || `区域 ${index + 1}`}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>
          </div>
        </aside>
      ) : null}

      <div
        ref={viewportRef}
        className={`mindmap-viewport ${mode === 'edit' ? 'editing' : ''}`}
        style={isLongImage ? { overflowY: 'auto', overflowX: 'hidden', alignItems: 'start' } : undefined}
        onPointerDown={onViewportPointerDown}
        onPointerMove={onViewportPointerMove}
        onPointerUp={finishViewportPointer}
        onPointerCancel={finishViewportPointer}
        onWheel={onWheel}
      >
        <div
          className="mindmap-stage"
          style={{
            width: `${fittedStageSize.width}px`,
            height: `${fittedStageSize.height}px`,
            transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
          }}
        >
          <img
            className="mindmap-image"
            src={currentImageSrc}
            width={currentSource?.width ?? 1}
            height={currentSource?.height ?? 1}
            draggable={false}
            alt={currentSource?.title ?? '思维导图'}
          />

          {mode === 'edit' ? (
            <div
              ref={editorLayerRef}
              className="manual-editor-layer"
              onPointerDown={beginDraw}
              onPointerMove={updateEditorGesture}
              onPointerUp={finishEditorGesture}
              onPointerCancel={finishEditorGesture}
            >
              {drafts.map((region, index) => (
                <div
                  key={region.region_id}
                  className={`manual-edit-region ${selectedDraftId === region.region_id ? 'selected' : ''}`}
                  style={{
                    left: `${region.x * 100}%`,
                    top: `${region.y * 100}%`,
                    width: `${region.width * 100}%`,
                    height: `${region.height * 100}%`,
                  }}
                  onPointerDown={(event) => beginEditGesture(event, region, 'move')}
                >
                  <span>{region.label || `区域 ${index + 1}`}</span>
                  <button
                    className="resize-handle"
                    type="button"
                    aria-label="调整遮挡大小"
                    onPointerDown={(event) => beginEditGesture(event, region, 'resize')}
                  />
                </div>
              ))}
            </div>
          ) : (
            activeRegions.map((region, index) => {
              const isMasked = regionState[region.region_id] !== 'REVEALED';
              const item = schedule[region.region_id];
              const cardState = item?.state ?? 'UNKNOWN';
              const completedToday = !!item?.reviewedToday;
              const isReviewTarget = mode === 'review' && activeRegionId === region.region_id;
              if (mode === 'review' && !matchesReviewFilter(region.region_id)) return null;
              const completedView = mode === 'review' && reviewFilter === 'COMPLETED';
              const displayMasked = isMasked && !completedView;
              return (
                <StudyRegionButton
                  key={region.region_id}
                  region={region}
                  index={index}
                  displayMasked={displayMasked}
                  cardState={cardState}
                  completedToday={completedToday}
                  isReviewTarget={isReviewTarget}
                  reviewPeer={mode === 'review'}
                  queuePulse={queuePulseRegionId === region.region_id}
                  mode={mode}
                  onToggle={reveal}
                />
              );
            })
          )}
        </div>

        {!loading && mode !== 'edit' && !currentSource ? (
          <div className="empty-region-message">当前没有页面，请点“加入页面”导入脑图图片。</div>
        ) : !loading && mode !== 'edit' && activeRegions.length === 0 ? (
          <div className="empty-region-message">还没有遮挡区域，请先在编辑遮挡中手动创建。</div>
        ) : null}

        {mode === 'edit' ? (
          <aside className="editor-panel">
            <div className="editor-panel-title">手动遮挡 · {drafts.length} 个</div>
            {selectedDraft ? (
              <>
                <div className="region-auto-label">{selectedDraft.label || '当前遮挡'}</div>
                <div className="editor-hint">无需输入答案文字。调整位置/大小后点“保存并绑定”。</div>
                <button
                  className="delete-region-button"
                  type="button"
                  onClick={() => {
                    setDrafts((current) =>
                      current.filter((region) => region.region_id !== selectedDraft.region_id),
                    );
                    setSelectedDraftId(null);
                  }}
                >
                  停用这个遮挡
                </button>
              </>
            ) : (
              <div className="editor-hint">在图片上直接拖框；不需要填写名称或答案。</div>
            )}
            {saveMessage ? (
              <div className={saveState === 'ERROR' ? 'save-error' : 'save-status'}>{saveMessage}</div>
            ) : null}
            <div className="no-delete-note">删除遮挡只停用显示；不会删除或移入垃圾箱任何 Rem/Card。</div>
          </aside>
        ) : null}

        {currentSource ? (
          <div
            role="group"
            aria-label="缩放控制"
            onPointerDown={(event) => event.stopPropagation()}
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              zIndex: 30,
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              backgroundColor: 'rgba(255, 255, 255, 0.92)',
              borderRadius: 999,
              padding: '4px 6px',
              boxShadow: '0 2px 12px rgba(15, 23, 42, 0.18)',
              border: '1px solid rgba(15, 23, 42, 0.08)',
              userSelect: 'none',
            }}
          >
            <button
              type="button"
              aria-label="缩小"
              title="缩小"
              onClick={() => zoomBy(1 / 1.25)}
              style={{
                width: 28,
                height: 28,
                borderRadius: 999,
                border: 'none',
                backgroundColor: 'transparent',
                color: '#1e293b',
                fontSize: 16,
                lineHeight: 1,
                cursor: 'pointer',
              }}
            >
              −
            </button>
            <button
              type="button"
              aria-label="适应屏幕"
              title="适应屏幕"
              onClick={() => setTransform({ x: 0, y: 0, scale: 1 })}
              style={{
                minWidth: 52,
                height: 28,
                borderRadius: 999,
                border: 'none',
                backgroundColor: 'transparent',
                color: '#1e293b',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {Math.round(transform.scale * 100)}%
            </button>
            <button
              type="button"
              aria-label="放大"
              title="放大"
              onClick={() => zoomBy(1.25)}
              style={{
                width: 28,
                height: 28,
                borderRadius: 999,
                border: 'none',
                backgroundColor: 'transparent',
                color: '#1e293b',
                fontSize: 16,
                lineHeight: 1,
                cursor: 'pointer',
              }}
            >
              +
            </button>
          </div>
        ) : null}
      </div>

      {mode === 'review' && reviewFilter === 'COMPLETED' ? (
        <section className="rating-dock completed-review-dock" aria-label="今日已完成">
          <div className="completed-review-message">
            <strong>本次已完成 {completedTodayCount} 张</strong>
            <span>这里只显示本次会话已真实评分完成的卡；查看不会再次写 RN 调度。</span>
          </div>
        </section>
      ) : mode === 'review' && globalReviewQueue.length === 0 ? (
        <section className="rating-dock completed-review-dock" aria-label="当前筛选无待复习卡">
          <div className="completed-review-message">
            <strong>{reviewFilter === 'DUE' ? '当前没有到期卡' : reviewFilter === 'NEW' ? '当前没有新卡' : '当前学习池任务已完成'}</strong>
            <span>不会显示无效评分按钮；需要额外练习可切到“自由背诵”。</span>
          </div>
        </section>
      ) : mode === 'review' && activeRegionId && regionState[activeRegionId] !== 'REVEALED' ? null : mode === 'review' ? (
        <section className="rating-dock" aria-label="RemNote FSRS 评分">
          <div className="rating-context">
            <div className="rating-context-main">
              <strong>
                {activeRegion
                  ? `${reviewFilter !== 'COMPLETED' && currentQueueIndex >= 0 ? `第 ${currentQueueIndex + 1}/${globalReviewQueue.length} 题 · ` : ''}${activeRegion.label || `区域 ${activeRegions.findIndex((item) => item.region_id === activeRegion.region_id) + 1}`}`
                  : globalReviewQueue.length === 0
                    ? '当前学习池任务已完成'
                    : '正在准备下一题'}
              </strong>
              <span>
                {activeRegionId
                  ? regionState[activeRegionId] === 'REVEALED'
                    ? `答案已揭示 · ${stateLabels[activeSchedule?.state ?? 'UNKNOWN']}${activeSchedule?.nextRepetitionTime ? ` · 当前计划 ${formatIntervalFromNow(activeSchedule.nextRepetitionTime)}` : ''} · 评分后自动进入下一题`
                    : `${stateLabels[activeSchedule?.state ?? 'UNKNOWN']} · 先回忆，再单击遮挡 / 按 Space 查看答案`
                  : '只排入 RemNote 真实 DUE + NEW；评分后自动推进，不提前复习未到期卡'}
              </span>
            </div>
            <div className="rating-context-side">
              {activeRating?.state === 'SAVING' ? <span className="rating-saving">正在写入 RN…</span> : null}
              {activeScoreLabel ? <span className="rating-result">下次 {activeScoreLabel}</span> : null}
              {!activeScoreLabel && lastNativeWrite ? (
                <span className="rating-result">RN 已验证：{lastNativeWrite.label}{lastNativeWrite.interval ? ` → ${lastNativeWrite.interval}` : ''}</span>
              ) : null}
              {activeRating?.message ? <span className="rating-warning">{activeRating.message}</span> : null}
            </div>
          </div>
          <div className="anki-score-grid" role="group" aria-label="评分">
            {scoreButtons.map((item, index) => {
              const selected = activeRating?.score === item.score && activeRating?.state === 'DONE';
              // Public SDK 0.0.46 does not expose four pre-rating interval candidates.
              // Never substitute a local estimate. After a real write, the selected
              // choice may display RN's actual nextRepetitionTime.
              const intervalLabel = selected && activeRating?.nextRepetitionTime
                ? formatIntervalFromNow(activeRating.nextRepetitionTime)
                : '暂不可读取';
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`anki-score-button tone-${item.tone} ${selected ? 'selected' : ''}`}
                  title={`${item.label}：评分直接写入当前 RN Native Card / Scheduler；评分直接写 RN；评分前四档预测仅在官方 API 可追溯时显示；快捷键 ${item.key}`}
                  data-rn-score={item.score}
                  disabled={!activeRegionId || !ratingAllowed}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => {
                    if (!activeRegionId) return;
                    void submitScore(activeRegionId, item.score);
                  }}
                >
                  <span className={`score-interval ${intervalLabel === '暂不可读取' ? 'unavailable' : ''}`}>{intervalLabel}</span>
                  <span className="score-label">{item.label}</span>
                  <kbd>{item.key}</kbd>
                </button>
              );
            })}
          </div>
          <div className="rating-footnote">
            {ratingDisabledReason || rnIntervalPreviewDiagnostic}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function MindmapViewerRoot() {
  return (
    <PluginErrorBoundary>
      <MindmapViewer />
    </PluginErrorBoundary>
  );
}

renderWidget(MindmapViewerRoot);
