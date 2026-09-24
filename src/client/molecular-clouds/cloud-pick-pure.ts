// Cloud pick scoring + winner resolution: proportional centrality among
// the clouds whose silhouette encloses the cursor. See ./README.md#picking--hover.

import {
  pickFromCandidates,
  type PickCandidate,
  type PickResult,
} from '../camera/controls/star-geometry';

// Denominator floor. A cloud whose silhouette has collapsed to a
// sub-pixel dot still scores finitely, so it can win when it is the only
// hit instead of producing NaN/Infinity comparisons.
const SILHOUETTE_RADIUS_FLOOR_PX = 0.5;

export type CloudPickCandidate = PickCandidate & {
  cameraDistancePc: number;
};

/**
 * Build a candidate from one enclosing-silhouette hit. The rim-mesh
 * raycast already IS the enclosure test, so the candidate is `enclosed`
 * outright and `hitRadius` reports the cloud's projected size alone —
 * what ranks it against everything else under the same cursor.
 */
export function cloudPickCandidate(
  idx: number,
  pxDistFromCentre: number,
  cameraDistancePc: number,
  silhouetteDiameterPx: number,
): CloudPickCandidate {
  return {
    idx,
    pxDist: pxDistFromCentre,
    hitRadius: Math.max(silhouetteDiameterPx * 0.5, SILHOUETTE_RADIUS_FLOOR_PX),
    enclosed: true,
    cameraDistancePc,
  };
}

/** Tightest silhouette wins, then proportional centrality within an
 *  equally-sized pair; null for an empty candidate list. The reducer's
 *  default scorer IS that centrality — `pxDist / hitRadius` over the
 *  radius `cloudPickCandidate` just built — so there is no cloud-specific
 *  scorer to pass. */
export function resolveCloudPick(
  candidates: Iterable<CloudPickCandidate>,
  pixelThreshold: number,
): PickResult<CloudPickCandidate> | null {
  return pickFromCandidates(candidates, pixelThreshold);
}
