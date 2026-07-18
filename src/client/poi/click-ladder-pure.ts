// Decision table for the navigate-mode click ladder on a non-focused
// point object — any pinnable kind steps the same rungs
// (README.md § Click ladder). Pure so every branch is unit-testable.

export type ClickLadderAction = 'pin' | 'vector' | 'clearVector' | 'clearBoth';

export interface ClickLadderState {
  /** PoiStore.pinnable(target) — SID-less records can't be pinned. */
  pinnable: boolean;
  /** Already in the POI list. */
  pinned: boolean;
  /** POI list already at POI_MAX_COUNT. */
  atCap: boolean;
  /** Already the distance-vector destination. */
  isVectorDest: boolean;
}

/**
 * State-based ladder for a navigate-mode click on a non-focused point
 * object: pin → vector → clear both. Objects that can't take the pin
 * rung right now (no-SID record, cap reached) fall through to the vector rung so
 * measuring to them stays possible.
 */
export function clickLadderAction(s: ClickLadderState): ClickLadderAction {
  if (s.pinned) return s.isVectorDest ? 'clearBoth' : 'vector';
  if (s.pinnable && !s.atCap) return 'pin';
  return s.isVectorDest ? 'clearVector' : 'vector';
}
