export type RegionState = 'MASKED' | 'REVEALED';

export type NativeCardState = 'NEW' | 'DUE' | 'NOT_DUE' | 'UNMAPPED' | 'UNKNOWN';
export type RatingState =
  | 'IDLE'
  | 'SAVING'
  | 'DONE'
  | 'SAVE_FAILED'
  | 'SAVE_UNKNOWN';

export type PublicCardSchedule = {
  nextRepetitionTime?: number;
  repetitionHistory?: readonly unknown[];
  lastRepetitionTime?: number;
};

export function makeInitialRegionState(regionIds: readonly string[]): Record<string, RegionState> {
  return Object.fromEntries(regionIds.map((id) => [id, 'MASKED'])) as Record<
    string,
    RegionState
  >;
}

export function revealOnlyTarget(
  state: Readonly<Record<string, RegionState>>,
  regionId: string,
): Record<string, RegionState> {
  if (state[regionId] !== 'MASKED') return { ...state };
  return { ...state, [regionId]: 'REVEALED' };
}

export function resetAllRegions(
  state: Readonly<Record<string, RegionState>>,
): Record<string, RegionState> {
  return makeInitialRegionState(Object.keys(state));
}

export function classifyNativeCard(
  card: PublicCardSchedule | undefined,
  hasBinding: boolean,
  now = Date.now(),
): NativeCardState {
  if (!hasBinding) return 'UNMAPPED';
  if (!card) return 'UNKNOWN';
  if (
    (Array.isArray(card.repetitionHistory) && card.repetitionHistory.length === 0) ||
    (card.repetitionHistory === undefined && card.lastRepetitionTime === undefined)
  ) {
    return 'NEW';
  }
  if (typeof card.nextRepetitionTime !== 'number') return 'UNKNOWN';
  if (!Array.isArray(card.repetitionHistory) && card.lastRepetitionTime === undefined) {
    return 'UNKNOWN';
  }
  return card.nextRepetitionTime <= now ? 'DUE' : 'NOT_DUE';
}

export function canSubmitNativeScore(
  mode: 'free' | 'review',
  regionState: RegionState,
  cardState: NativeCardState,
  ratingState: RatingState,
) {
  return (
    mode === 'review' &&
    regionState === 'REVEALED' &&
    (cardState === 'NEW' || cardState === 'DUE') &&
    ratingState === 'IDLE'
  );
}
