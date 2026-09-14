// Cloud pick scoring + winner resolution: proportional centrality among
// the clouds whose silhouette encloses the cursor. See ./README.md
// § Picking + hover.

import {
  pickFromCandidates,
  type PickCandidate,
  type PickResult,
} from '../camera/controls/star-geometry';

// Denominator floor. A cloud whose silhouette has collapsed to a
// sub-pixel dot still scores finitely, so it can win when it is the only
// hit instead of producing NaN/Infinity comparisons.
const SILHOUETTE_RADIUS_FLOOR_PX = 0.5;

/**
 * Cursor distance from the cloud's projected centre as a fraction of
 * that cloud's own projected radius: 0 dead centre, 1 at the silhouette
 * edge. Scale-invariant by construction — a small cloud and a large
 * complex both stay reachable, each winning the region where the cursor
 * sits proportionally deeper inside it.
 */
export function cloudPickScore(pxDistFromCentre: number, silhouetteDiameterPx: number): number {
  return pxDistFromCentre / Math.max(silhouetteDiameterPx * 0.5, SILHOUETTE_RADIUS_FLOOR_PX);
}

export type CloudPickCandidate = PickCandidate & {
  cameraDistancePc: number;
  silhouetteDiameterPx: number;
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
    silhouetteDiameterPx,
  };
}

/** Tightest silhouette wins, then proportional centrality within an
 *  equally-sized pair; null for an empty candidate list. */
export function resolveCloudPick(
  candidates: Iterable<CloudPickCandidate>,
  pixelThreshold: number,
): PickResult<CloudPickCandidate> | null {
  return pickFromCandidates(
    candidates,
    pixelThreshold,
    (c) => cloudPickScore(c.pxDist, c.silhouetteDiameterPx),
  );
}
