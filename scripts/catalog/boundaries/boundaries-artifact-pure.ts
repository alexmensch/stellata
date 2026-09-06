// The public/constellation-boundaries.json wire shape: precessed boundary
// polylines plus the magnitude-keyed fade-quantile table.
// See README.md.

import {
  buildBoundaryPolylines,
  buildRegionLabelAnchors,
  POLYLINE_MAX_STEP_DEG,
  type BoundaryPolyline,
  type ConstellationRegionGrid,
  type IauBoundaryEdges,
  type RegionLabelAnchor,
} from '../../../src/client/constellation-boundaries/iau-geometry/iau-boundaries-pure';

/** Decimals kept per direction component. One unit in the last place is
 *  1e-7 rad ≈ 0.02″ of sky, two orders under the arcsecond the round-trip
 *  test holds the artifact to, and it halves the JSON against full float64. */
export const DIRECTION_DECIMALS = 7;

/** Decimals kept per fade offset. 1e-4 pc ≈ 20 AU against a smallest emitted
 *  offset near 0.02 pc, so three significant figures survive on the tightest
 *  row. Rounding also keeps the emitted width fixed: unrounded, these are the
 *  only float64s in the artifact, they derive from a 380k-star sweep, and a
 *  last-bit difference in one star's trig moves the file size — which
 *  `boundaryArtifactKb` would then report as a change. */
export const FADE_OFFSET_DECIMALS = 4;

/** Angular slack before a star reads as sitting on the wrong side of a wall.
 *  Half a degree is roughly where a boundary–star mismatch becomes legible
 *  rather than arguable. */
export const MISPLACEMENT_TOLERANCE_DEG = 0.5;

/** Apparent-magnitude limits the fade quantiles are keyed by. Spans 0–15 at
 *  1 mag, wide enough for any instrument's limit; the runtime lerps between
 *  rows. */
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

/** Decimals kept per region area. Published IAU areas are quoted to 2. */
export const AREA_DECIMALS = 2;

/** One region's chart label anchor: `c` its edge-set code (`SER1`/`SER2` stay
 *  split, so Serpens gets two), `d` the ICRS direction of its equal-surface-
 *  weight centre of mass, `a` its area in square degrees. */
export interface BoundaryLabelWire {
  c: string;
  d: [number, number, number];
  a: number;
}

/** The B1875 cell grid resolved to region codes, for the runtime membership
 *  lookup any position — planet, galaxy, cloud — resolves through.
 *
 *  **The bounds are emitted at full precision, unlike every other number in
 *  this artifact.** `constellationEdgeCodeAt` bisects them, so a rounded bound
 *  is a moved wall: the runtime would answer a different constellation from
 *  the byte 34 this same grid assigned, for positions near it. Rounding here
 *  buys ~2 KiB and costs the one property that makes two answers one answer. */
export interface RegionGridWire {
  /** RA column bounds, degrees ascending. The last column wraps past RA 0. */
  raDeg: number[];
  /** Dec band bounds, degrees ascending; ±90 close the outermost bands. */
  decDeg: number[];
  /** Region codes the runs index into. */
  codes: string[];
  /** Band-major run-length pairs `[cellCount, codeIndex, …]`. Runs never
   *  straddle a band, so each band's counts sum to the column count — which is
   *  what `decodeRegionGrid` checks rather than trusting a total. */
  runs: number[];
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
  labels: BoundaryLabelWire[];
  regions: RegionGridWire;
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

export function toLabelWire(anchor: RegionLabelAnchor): BoundaryLabelWire {
  return {
    c: anchor.code,
    d: [
      quantise(anchor.direction.x, DIRECTION_DECIMALS),
      quantise(anchor.direction.y, DIRECTION_DECIMALS),
      quantise(anchor.direction.z, DIRECTION_DECIMALS),
    ],
    a: quantise(anchor.areaSquareDeg, AREA_DECIMALS),
  };
}

/** Run-length the resolved cell grid along RA. Regions are contiguous blocks
 *  of columns, so 47,200 cells collapse to a few thousand runs. */
export function encodeRegionGrid(grid: ConstellationRegionGrid): RegionGridWire {
  const codes = [...new Set(grid.cellCon)].sort();
  const codeIndex = new Map(codes.map((code, i) => [code, i]));
  const columns = grid.raBoundsDeg.length;
  const runs: number[] = [];
  for (let cell = 0; cell < grid.cellCon.length; cell += columns) {
    let i = 0;
    while (i < columns) {
      const code = grid.cellCon[cell + i];
      let end = i + 1;
      while (end < columns && grid.cellCon[cell + end] === code) end++;
      runs.push(end - i, codeIndex.get(code)!);
      i = end;
    }
  }
  return {
    raDeg: [...grid.raBoundsDeg],
    decDeg: [...grid.decBoundsDeg],
    codes,
    runs,
  };
}

/** Throws unless the bounds ascend and the runs tile the exact
 *  `columns × bands` grid those bounds describe. **Checked without allocating
 *  the grid**, so the load-time validator can run it and `decodeRegionGrid`
 *  needs no failure path of its own: a run list that stops short otherwise
 *  decodes to a grid holding `undefined` cells, and those resolve as a
 *  constellation named "undefined" rather than as an error. */
export function validateRegionGridWire(wire: RegionGridWire): void {
  const columns = wire.raDeg?.length ?? 0;
  if (columns === 0 || !wire.decDeg?.length || !wire.codes?.length || !wire.runs) {
    throw new Error('region grid is missing bounds, codes, or runs');
  }
  // `constellationEdgeCodeAt` bisects both bound arrays, so an out-of-order or
  // non-finite bound is a wall in the wrong place — it resolves to a real
  // constellation, just the wrong one, which no spot check catches.
  assertAscendingBounds('raDeg', wire.raDeg);
  assertAscendingBounds('decDeg', wire.decDeg);
  const bands = wire.decDeg.length + 1;
  let at = 0;
  for (let band = 0; band < bands; band++) {
    let column = 0;
    while (column < columns) {
      const count = wire.runs[at];
      if (!Number.isInteger(count) || count < 1 || wire.codes[wire.runs[at + 1]] === undefined) {
        throw new Error(`region grid run ${at / 2} is malformed`);
      }
      if (column + count > columns) {
        throw new Error(
          `region grid band ${band} overruns ${columns} columns at run ${at / 2}`,
        );
      }
      column += count;
      at += 2;
    }
  }
  if (at !== wire.runs.length) {
    throw new Error(
      `region grid carries ${wire.runs.length / 2} runs, ${at / 2} tile the grid`,
    );
  }
}

function assertAscendingBounds(field: string, bounds: readonly number[]): void {
  for (let i = 0; i < bounds.length; i++) {
    if (!Number.isFinite(bounds[i])) {
      throw new Error(`region grid ${field}[${i}] is ${bounds[i]}`);
    }
    if (i > 0 && bounds[i] <= bounds[i - 1]) {
      throw new Error(
        `region grid ${field} must ascend (${field}[${i}] is ${bounds[i]} `
        + `after ${bounds[i - 1]})`,
      );
    }
  }
}

/** Rebuild the cell grid from the wire, in the band-major order
 *  `constellationEdgeCodeAt` indexes. Validates first, so the one caller that
 *  did not come through `validateBoundaryArtifact` — the build, reading its own
 *  freshly encoded grid — is covered too. Bounds are copied: the decoded grid
 *  outlives the parsed artifact object in the browser. */
export function decodeRegionGrid(wire: RegionGridWire): ConstellationRegionGrid {
  validateRegionGridWire(wire);
  const columns = wire.raDeg.length;
  const cellCon = new Array<string>(columns * (wire.decDeg.length + 1));
  let cell = 0;
  for (let at = 0; at < wire.runs.length; at += 2) {
    const count = wire.runs[at];
    cellCon.fill(wire.codes[wire.runs[at + 1]], cell, cell + count);
    cell += count;
  }
  return {
    raBoundsDeg: [...wire.raDeg],
    decBoundsDeg: [...wire.decDeg],
    cellCon,
  };
}

/** One star's contribution to the fade table. */
export interface FadeSample {
  /** `(angular distance to the nearest wall + tolerance) × distance from Sol`
   *  — the camera offset at which this star reads as misplaced. */
  offsetPc: number;
  /** Apparent V from Sol, which is what the instrument's limit gates on. */
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

/** Arcs, labels, region grid and fade table from ONE decomposition of the edge
 *  set, so the drawn partition, the labels written on it, and the membership
 *  the catalogue shipped in byte 34 cannot disagree with each other. */
export function buildBoundaryArtifact(
  geometry: { edges: IauBoundaryEdges; grid: ConstellationRegionGrid },
  samples: readonly FadeSample[],
): BoundaryArtifact {
  return {
    epoch: 'B1875',
    frame: 'ICRS',
    stepDeg: POLYLINE_MAX_STEP_DEG,
    segments: buildBoundaryPolylines(geometry.edges).map(toSegmentWire),
    labels: buildRegionLabelAnchors(geometry.grid).map(toLabelWire),
    regions: encodeRegionGrid(geometry.grid),
    fade: buildFadeTable(samples),
  };
}

export function countDirections(segments: readonly BoundarySegmentWire[]): number {
  return segments.reduce((n, s) => n + s.d.length / 3, 0);
}
