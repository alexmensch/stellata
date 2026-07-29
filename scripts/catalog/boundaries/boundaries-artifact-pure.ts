// The public/constellation-boundaries.json wire shape: precessed boundary
// polylines plus the magnitude-keyed fade-quantile table.
// See README.md.

import {
  buildBoundaryPolylines,
  POLYLINE_MAX_STEP_DEG,
  type BoundaryPolyline,
  type IauBoundaryEdges,
} from '../../../src/client/constellation-boundaries/iau-boundaries-pure';

/** Decimals kept per direction component. One unit in the last place is
 *  1e-7 rad ≈ 0.02″ of sky, two orders under the arcsecond the round-trip
 *  test holds the artifact to, and it halves the JSON against full float64. */
export const DIRECTION_DECIMALS = 7;

/** Decimals kept per fade offset. 1e-4 pc ≈ 20 AU against a smallest emitted
 *  offset near 0.02 pc, so three significant figures survive on the tightest
 *  row. Rounding also keeps the emitted width fixed: unrounded, these are the
 *  only float64s in the artifact, they derive from a 330k-star sweep, and a
 *  last-bit difference in one star's trig moves the file size — which
 *  `boundaryArtifactKb` would then report as a change. */
export const FADE_OFFSET_DECIMALS = 4;

/** Angular slack before a star reads as sitting on the wrong side of a wall.
 *  Half a degree is roughly where a boundary–star mismatch becomes legible
 *  rather than arguable. */
export const MISPLACEMENT_TOLERANCE_DEG = 0.5;

/** Apparent-magnitude limits the fade quantiles are keyed by. Spans the
 *  magnitude slider's 0–15 range at 1 mag; the runtime lerps between rows. */
export const FADE_MAG_LIMITS: readonly number[] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
];

/** Percentile ranks emitted per magnitude limit. */
export const FADE_QUANTILE_PCTS: readonly number[] = [0.1, 1, 5, 50];

/** Rows thinner than this are dropped rather than emitted: a percentile over a
 *  handful of stars is sampling noise, and the runtime clamps to the nearest
 *  emitted row anyway. */
export const FADE_MIN_SAMPLES = 64;

/** One arc: `k` its kind, `c` the two constellations it separates (in source
 *  order, which carries NO side convention), `d` flat ICRS x,y,z triples in
 *  arc order. */
export interface BoundarySegmentWire {
  k: 'M' | 'P';
  c: [string, string];
  d: number[];
}

export interface BoundaryFadeTableWire {
  magLimits: number[];
  quantilePcts: number[];
  /** `offsetsPc[i][j]` — how far from Sol the camera can move before
   *  `quantilePcts[j]` percent of the population visible at `magLimits[i]`
   *  reads as being in the wrong constellation. */
  offsetsPc: number[][];
  /** Stars behind each row, so a thin row is visible rather than implied. */
  sampleCounts: number[];
}

export interface BoundaryArtifact {
  /** Equinox the source arcs are drawn at — not the frame `d` is in. */
  epoch: 'B1875';
  /** Frame the emitted directions are in. */
  frame: 'ICRS';
  /** Maximum angular gap between consecutive samples, degrees. */
  stepDeg: number;
  segments: BoundarySegmentWire[];
  fade: BoundaryFadeTableWire;
}

function quantise(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

export function toSegmentWire(polyline: BoundaryPolyline): BoundarySegmentWire {
  const d: number[] = [];
  for (const v of polyline.directions) {
    d.push(
      quantise(v.x, DIRECTION_DECIMALS),
      quantise(v.y, DIRECTION_DECIMALS),
      quantise(v.z, DIRECTION_DECIMALS),
    );
  }
  return { k: polyline.kind, c: [polyline.conA, polyline.conB], d };
}

/** One star's contribution to the fade table. */
export interface FadeSample {
  /** `(angular distance to the nearest wall + tolerance) × distance from Sol`
   *  — the camera offset at which this star reads as misplaced. */
  offsetPc: number;
  /** Apparent V from Sol, which is what the magnitude slider gates on. */
  appMag: number;
}

export function misplacementOffsetPc(
  nearestEdgeDeg: number,
  distancePc: number,
): number {
  return (nearestEdgeDeg + MISPLACEMENT_TOLERANCE_DEG) * (Math.PI / 180) * distancePc;
}

/** Quantiles of the misplacement offset per magnitude limit. Samples are
 *  sorted by offset once and each limit then walks that order, so adding a
 *  limit costs a pass rather than another sort. */
export function buildFadeTable(
  samples: readonly FadeSample[],
  magLimits: readonly number[] = FADE_MAG_LIMITS,
  quantilePcts: readonly number[] = FADE_QUANTILE_PCTS,
): BoundaryFadeTableWire {
  const byOffset = [...samples].sort((a, b) => a.offsetPc - b.offsetPc);
  const emitted: number[] = [];
  const offsetsPc: number[][] = [];
  const sampleCounts: number[] = [];

  for (const limit of magLimits) {
    const total = byOffset.reduce((n, s) => n + (s.appMag <= limit ? 1 : 0), 0);
    if (total < FADE_MIN_SAMPLES) continue;
    // Rank of each requested percentile, 1-based within the qualifying subset.
    const ranks = quantilePcts.map((pct) => Math.max(1, Math.ceil((pct / 100) * total)));
    const row = new Array<number>(ranks.length).fill(NaN);
    let seen = 0;
    let filled = 0;
    for (const sample of byOffset) {
      if (sample.appMag > limit) continue;
      seen++;
      for (let j = 0; j < ranks.length; j++) {
        if (Number.isNaN(row[j]) && seen >= ranks[j]) {
          row[j] = quantise(sample.offsetPc, FADE_OFFSET_DECIMALS);
          filled++;
        }
      }
      if (filled === ranks.length) break;
    }
    emitted.push(limit);
    offsetsPc.push(row);
    sampleCounts.push(total);
  }

  if (emitted.length < 2) {
    throw new Error(
      `Fade table needs at least two magnitude rows to interpolate between; got ${emitted.length}`,
    );
  }
  return {
    magLimits: emitted,
    quantilePcts: [...quantilePcts],
    offsetsPc,
    sampleCounts,
  };
}

export function buildBoundaryArtifact(
  edges: IauBoundaryEdges,
  samples: readonly FadeSample[],
): BoundaryArtifact {
  return {
    epoch: 'B1875',
    frame: 'ICRS',
    stepDeg: POLYLINE_MAX_STEP_DEG,
    segments: buildBoundaryPolylines(edges).map(toSegmentWire),
    fade: buildFadeTable(samples),
  };
}

export function countDirections(segments: readonly BoundarySegmentWire[]): number {
  return segments.reduce((n, s) => n + s.d.length / 3, 0);
}
