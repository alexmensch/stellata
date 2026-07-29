// Pure inputs to the chart-mode boundary layer: polyline → line-segment
// vertex expansion and the magnitude-keyed fade window.
// See README.md § Chart-mode layer.

import type {
  BoundaryFadeTableWire,
  BoundarySegmentWire,
} from '../../../scripts/catalog/boundaries/boundaries-artifact-pure';
import { smoothstep } from '../galactic/galactic-fade';

/** Share of the magnitude-limited population that may read as misplaced
 *  before the boundaries start fading, and where they reach zero. Both must
 *  be columns of the artifact's own `quantilePcts` — the loader rejects an
 *  artifact that dropped either, rather than silently picking a neighbour. */
export const FADE_START_MISPLACED_PCT = 1;
export const FADE_END_MISPLACED_PCT = 5;

export interface BoundaryFadeWindow {
  /** Camera distance from Sol, pc, at which opacity starts dropping. */
  innerPc: number;
  /** Camera distance from Sol, pc, at which opacity reaches zero. */
  outerPc: number;
}

/** Flat x,y,z endpoint pairs for `THREE.LineSegments`, each direction scaled
 *  to `radiusPc`. A polyline of n samples contributes n−1 segments, so
 *  consecutive arcs never join across the seam between two edge records. */
export function boundarySegmentVertices(
  segments: readonly BoundarySegmentWire[],
  radiusPc: number,
): Float32Array {
  let vertices = 0;
  for (const seg of segments) vertices += Math.max(0, seg.d.length / 3 - 1) * 2;
  const out = new Float32Array(vertices * 3);
  let o = 0;
  for (const seg of segments) {
    const samples = seg.d.length / 3;
    for (let i = 0; i + 1 < samples; i++) {
      const a = i * 3;
      out[o++] = seg.d[a] * radiusPc;
      out[o++] = seg.d[a + 1] * radiusPc;
      out[o++] = seg.d[a + 2] * radiusPc;
      out[o++] = seg.d[a + 3] * radiusPc;
      out[o++] = seg.d[a + 4] * radiusPc;
      out[o++] = seg.d[a + 5] * radiusPc;
    }
  }
  return out;
}

/**
 * The fade window for a live magnitude limit, interpolated out of the
 * artifact's quantile table. Between two emitted rows the offsets lerp; past
 * either end they clamp, since the slider reaches limits the table has too
 * few stars to describe.
 */
export function resolveBoundaryFadeWindowPc(
  fade: BoundaryFadeTableWire,
  maxAppMag: number,
): BoundaryFadeWindow {
  const innerCol = quantileColumn(fade, FADE_START_MISPLACED_PCT);
  const outerCol = quantileColumn(fade, FADE_END_MISPLACED_PCT);
  const { lo, hi, t } = bracketMagRow(fade.magLimits, maxAppMag);
  return {
    innerPc: lerpOffset(fade.offsetsPc, lo, hi, t, innerCol),
    outerPc: lerpOffset(fade.offsetsPc, lo, hi, t, outerCol),
  };
}

/**
 * Opacity multiplier at `distFromSolPc` — 1 inside the window, 0 beyond it.
 * The inverse of the far-field reveal in `galactic/galactic-fade.ts`: a drawn
 * boundary is a Sol-frame projection with no 3D referent, so it must
 * self-hide as the camera leaves the neighbourhood rather than appear as the
 * camera pulls back.
 */
export function boundaryFadeFactor(
  distFromSolPc: number,
  fadeWindow: BoundaryFadeWindow,
): number {
  // A table row whose two quantiles round to the same offset would make
  // smoothstep divide by zero; step at the window instead.
  if (fadeWindow.outerPc <= fadeWindow.innerPc) {
    return distFromSolPc < fadeWindow.outerPc ? 1 : 0;
  }
  return 1 - smoothstep(fadeWindow.innerPc, fadeWindow.outerPc, distFromSolPc);
}

function quantileColumn(fade: BoundaryFadeTableWire, pct: number): number {
  const col = fade.quantilePcts.indexOf(pct);
  if (col < 0) {
    throw new Error(
      `Boundary fade table carries no ${pct}% quantile (has ${fade.quantilePcts.join(', ')})`,
    );
  }
  return col;
}

/** Bracketing row indices for `maxAppMag` in an ascending `magLimits`, plus
 *  the fraction between them. Clamps to a single row at either end. */
function bracketMagRow(
  magLimits: readonly number[],
  maxAppMag: number,
): { lo: number; hi: number; t: number } {
  const last = magLimits.length - 1;
  if (maxAppMag <= magLimits[0]) return { lo: 0, hi: 0, t: 0 };
  if (maxAppMag >= magLimits[last]) return { lo: last, hi: last, t: 0 };
  let hi = 1;
  while (magLimits[hi] < maxAppMag) hi++;
  const lo = hi - 1;
  return { lo, hi, t: (maxAppMag - magLimits[lo]) / (magLimits[hi] - magLimits[lo]) };
}

function lerpOffset(
  offsetsPc: readonly number[][],
  lo: number,
  hi: number,
  t: number,
  col: number,
): number {
  const a = offsetsPc[lo][col];
  return a + t * (offsetsPc[hi][col] - a);
}
