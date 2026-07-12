// Decision table for the navigate-mode star-click ladder
// (README.md § Click ladder). Pure so every branch is unit-testable.

export type StarLadderAction = 'pin' | 'vector' | 'clearVector' | 'clearBoth';

export interface StarLadderState {
  /** PoiStore.pinnable(idx) — Sol and SID-less records can't be pinned. */
  pinnable: boolean;
  /** Already in the POI list. */
  pinned: boolean;
  /** POI list already at POI_MAX_COUNT. */
  atCap: boolean;
  /** Already the distance-vector destination. */
  isVectorDest: boolean;
}

/**
 * State-based ladder for a navigate-mode click on a non-focused star:
 * pin → vector → clear both. Stars that can't take the pin rung right
 * now (Sol, cap reached) fall through to the vector rung so measuring
 * to them stays possible.
 */
export function starLadderAction(s: StarLadderState): StarLadderAction {
  if (s.pinned) return s.isVectorDest ? 'clearBoth' : 'vector';
  if (s.pinnable && !s.atCap) return 'pin';
  return s.isVectorDest ? 'clearVector' : 'vector';
}
