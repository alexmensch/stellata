// Pure inputs to the chart-mode boundary layer: polyline → line-segment
// vertex expansion, the dash phase along each polyline, and the
// magnitude-keyed fade window. See README.md § Chart-mode layer.

import type {
  BoundaryFadeTableWire,
  BoundarySegmentWire,
} from '../../../scripts/catalog/boundaries/boundaries-artifact-pure';
import type { SolFrameFadeWindow } from '../galactic/galactic-fade';

/** Share of the magnitude-limited population that may read as misplaced
 *  before the boundaries start fading, and where they reach zero. Both must
 *  be columns of the artifact's own `quantilePcts` — the loader rejects an
 *  artifact that dropped either, rather than silently picking a neighbour. */
export const FADE_START_MISPLACED_PCT = 1;
export const FADE_END_MISPLACED_PCT = 5;

/** The two `THREE.LineSegments` attributes an arc set expands into. */
export interface BoundaryLineAttributes {
  /** Flat x,y,z endpoint pairs, each direction scaled to `radiusPc`. */
  positions: Float32Array;
  /** Arc length travelled from the start of each vertex's own polyline, in the
   *  same world units — one per vertex, the dash phase. */
  lineDistances: Float32Array;
}

/** Endpoint pairs plus the dash phase for an arc set. A polyline of n samples
 *  contributes n−1 segments, so consecutive arcs never join across the seam
 *  between two edge records.
 *
 *  `lineDistances` accumulates **along the polyline**, not per pair the way
 *  three's `computeLineDistances` would: a per-pair phase restarts the pattern
 *  at every subdivision node, which draws a solid line wherever a node sits
 *  closer than one dash. Each arc restarts at 0, matching the segment split. */
export function boundaryLineAttributes(
  segments: readonly BoundarySegmentWire[],
  radiusPc: number,
): BoundaryLineAttributes {
  let vertices = 0;
  for (const seg of segments) vertices += Math.max(0, seg.d.length / 3 - 1) * 2;
  const positions = new Float32Array(vertices * 3);
  const lineDistances = new Float32Array(vertices);
  let o = 0;
  let d = 0;
  for (const seg of segments) {
    const samples = seg.d.length / 3;
    let travelled = 0;
    for (let i = 0; i + 1 < samples; i++) {
      const a = i * 3;
      const x0 = seg.d[a] * radiusPc;
      const y0 = seg.d[a + 1] * radiusPc;
      const z0 = seg.d[a + 2] * radiusPc;
      const x1 = seg.d[a + 3] * radiusPc;
      const y1 = seg.d[a + 4] * radiusPc;
      const z1 = seg.d[a + 5] * radiusPc;
      positions[o++] = x0;
      positions[o++] = y0;
      positions[o++] = z0;
      positions[o++] = x1;
      positions[o++] = y1;
      positions[o++] = z1;
      lineDistances[d++] = travelled;
      travelled += Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      lineDistances[d++] = travelled;
    }
  }
  return { positions, lineDistances };
}

/**
 * The fade window for a live magnitude limit, interpolated out of the
 * artifact's quantile table. Between two emitted rows the offsets lerp; past
 * either end they clamp, since an instrument can reach limits the table has
 * too few stars to describe.
 */
export function resolveBoundaryFadeWindowPc(
  fade: BoundaryFadeTableWire,
  limitMag: number,
): SolFrameFadeWindow {
  const innerCol = quantileColumn(fade, FADE_START_MISPLACED_PCT);
  const outerCol = quantileColumn(fade, FADE_END_MISPLACED_PCT);
  const { lo, hi, t } = bracketMagRow(fade.magLimits, limitMag);
  return {
    innerPc: lerpOffset(fade.offsetsPc, lo, hi, t, innerCol),
    outerPc: lerpOffset(fade.offsetsPc, lo, hi, t, outerCol),
  };
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

/** Bracketing row indices for `limitMag` in an ascending `magLimits`, plus
 *  the fraction between them. Clamps to a single row at either end. */
function bracketMagRow(
  magLimits: readonly number[],
  limitMag: number,
): { lo: number; hi: number; t: number } {
  const last = magLimits.length - 1;
  if (limitMag <= magLimits[0]) return { lo: 0, hi: 0, t: 0 };
  if (limitMag >= magLimits[last]) return { lo: last, hi: last, t: 0 };
  let hi = 1;
  while (magLimits[hi] < limitMag) hi++;
  const lo = hi - 1;
  return { lo, hi, t: (limitMag - magLimits[lo]) / (magLimits[hi] - magLimits[lo]) };
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
