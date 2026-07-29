// The IAU (Delporte 1930) constellation boundary edge set at equinox B1875,
// its decomposition into named regions, and positional lookup against them.
// See README.md.

import { RA_HOURS_TO_DEG } from '../util/astronomy-constants';
import { unitVectorFromRaDec, type SkyPosition } from '../util/equatorial-basis';
import { B1875_JD, precessRaDec, precessionRotationFromJ2000 } from '../util/precession';

/** A boundary arc of constant B1875 RA, spanning `decLoDeg` → `decHiDeg`. */
export interface MeridianEdge {
  raDeg: number;
  decLoDeg: number;
  decHiDeg: number;
  conA: string;
  conB: string;
}

/** A boundary arc of constant B1875 Dec running eastward from `raStartDeg` to
 *  `raEndDeg`, both in [0, 360) — so an end at or below the start wraps
 *  through RA 0 rather than describing a westward arc. Both endpoints stay as
 *  parsed: the cell grid keys on exact equality against them, which a
 *  reconstructed `start + span` breaks at the last float digit. */
export interface ParallelEdge {
  decDeg: number;
  raStartDeg: number;
  raEndDeg: number;
  conA: string;
  conB: string;
}

export interface IauBoundaryEdges {
  meridians: readonly MeridianEdge[];
  parallels: readonly ParallelEdge[];
}

/** 88 constellations plus Serpens' two disjoint parts (SER1 Caput, SER2
 *  Cauda). Nothing in the pipeline supplies this count — the edge set alone
 *  determines it — so a mismatch means the source data or the cell walk
 *  broke, and `buildConstellationRegions` throws rather than shipping a
 *  half-resolved sky. */
export const IAU_REGION_COUNT = 89;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Source coordinates are whole arcseconds on a grid whose finest step is
 *  5 arcmin, so exact-value comparisons only have sexagesimal-to-decimal
 *  rounding to survive. */
const COORD_EPSILON_DEG = 1e-9;

function parseSexagesimal(text: string): number {
  const parts = text.replace(/^[+-]/, '').split(':');
  if (parts.length !== 3) throw new Error(`Malformed sexagesimal value: ${text}`);
  const [a, b, c] = parts.map((p) => {
    const n = Number(p);
    if (!Number.isFinite(n)) throw new Error(`Malformed sexagesimal value: ${text}`);
    return n;
  });
  return (text.startsWith('-') ? -1 : 1) * (a + b / 60 + c / 3600);
}

/** Parses the `edges` records of Stellarium's modern skyculture (pbarbier
 *  `edges_18.txt`): `<id>:<id> <M|P>+ ra1 dec1 ra2 dec2 CON1 CON2`, ra as
 *  `hh:mm:ss` and dec as `±dd:mm:ss` at equinox B1875. M is a meridian
 *  (constant RA), P a parallel (constant Dec). The CON1/CON2 order carries no
 *  reliable side convention — never read it as "A lies west of B". */
export function parseIauEdges(records: readonly string[]): IauBoundaryEdges {
  const meridians: MeridianEdge[] = [];
  const parallels: ParallelEdge[] = [];

  for (const record of records) {
    const fields = record.trim().split(/\s+/);
    if (fields.length !== 8) {
      throw new Error(`IAU edge record has ${fields.length} fields, expected 8: ${record}`);
    }
    const [, kind, ra1, dec1, ra2, dec2, conA, conB] = fields;
    const raStartDeg = parseSexagesimal(ra1) * RA_HOURS_TO_DEG;
    const raEndRawDeg = parseSexagesimal(ra2) * RA_HOURS_TO_DEG;
    const decStartDeg = parseSexagesimal(dec1);
    const decEndDeg = parseSexagesimal(dec2);

    if (kind.startsWith('M')) {
      if (Math.abs(raStartDeg - raEndRawDeg) > COORD_EPSILON_DEG) {
        throw new Error(`Meridian edge spans two RA values: ${record}`);
      }
      meridians.push({
        raDeg: raStartDeg,
        decLoDeg: Math.min(decStartDeg, decEndDeg),
        decHiDeg: Math.max(decStartDeg, decEndDeg),
        conA,
        conB,
      });
    } else if (kind.startsWith('P')) {
      if (Math.abs(decStartDeg - decEndDeg) > COORD_EPSILON_DEG) {
        throw new Error(`Parallel edge spans two Dec values: ${record}`);
      }
      parallels.push({ decDeg: decStartDeg, raStartDeg, raEndDeg: raEndRawDeg, conA, conB });
    } else {
      throw new Error(`IAU edge record has unknown kind '${kind}': ${record}`);
    }
  }

  return { meridians, parallels };
}

/** The edge set decomposed into cells, each carrying the constellation
 *  covering it. Column `i` spans RA `[raBoundsDeg[i], raBoundsDeg[i + 1])`
 *  and wraps past the last; band `j` spans Dec
 *  `[decBoundsDeg[j - 1], decBoundsDeg[j])`, with −90 and +90 closing the
 *  first and last. */
export interface ConstellationRegionGrid {
  readonly raBoundsDeg: readonly number[];
  readonly decBoundsDeg: readonly number[];
  /** Band-major: `cellCon[j * raBoundsDeg.length + i]`. */
  readonly cellCon: readonly string[];
}

function sortedDistinct(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

class DisjointSet {
  private readonly parent: Int32Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    for (let i = 0; i < size; i++) this.parent[i] = i;
  }

  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
    let cur = x;
    while (this.parent[cur] !== root) {
      const next = this.parent[cur];
      this.parent[cur] = root;
      cur = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent[rootA] = rootB;
  }
}

function groupBy<T>(items: readonly T[], key: (item: T) => number): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const item of items) {
    const k = key(item);
    const at = out.get(k);
    if (at) at.push(item);
    else out.set(k, [item]);
  }
  return out;
}

function wrapDeg(raDeg: number): number {
  return ((raDeg % 360) + 360) % 360;
}

/** Eastward extent of a parallel arc. A start equal to its end is the full
 *  circle, never a zero-length arc. */
function parallelSpanDeg(edge: ParallelEdge): number {
  const spanDeg = wrapDeg(edge.raEndDeg - edge.raStartDeg);
  return spanDeg === 0 ? 360 : spanDeg;
}

function coversRaColumn(edge: ParallelEdge, columnLoDeg: number, columnHiDeg: number): boolean {
  const intoArcDeg = wrapDeg(columnLoDeg - edge.raStartDeg);
  return intoArcDeg + (columnHiDeg - columnLoDeg) <= parallelSpanDeg(edge) + COORD_EPSILON_DEG;
}

/** Walks the cell grid the edge coordinates induce, unions every adjacent
 *  pair no edge separates, then names each region by intersecting the
 *  {conA, conB} pairs of every edge bounding it — a set intersection, so the
 *  result never depends on which side of an edge a name was listed on. RA
 *  adjacency is cyclic, which is also what closes the two polar bands: their
 *  cells all meet at the pole and no meridian reaches past ±85°.
 *
 *  Throws unless the walk yields exactly `IAU_REGION_COUNT` regions with
 *  distinct names. */
export function buildConstellationRegions(edges: IauBoundaryEdges): ConstellationRegionGrid {
  const raBoundsDeg = sortedDistinct([
    ...edges.meridians.map((e) => e.raDeg),
    ...edges.parallels.flatMap((e) => [e.raStartDeg, e.raEndDeg]),
  ]);
  const decBoundsDeg = sortedDistinct([
    ...edges.meridians.flatMap((e) => [e.decLoDeg, e.decHiDeg]),
    ...edges.parallels.map((e) => e.decDeg),
  ]);

  const columns = raBoundsDeg.length;
  const bands = decBoundsDeg.length + 1;
  const bandEdgesDeg = [-90, ...decBoundsDeg, 90];
  const cellIndex = (i: number, j: number) => j * columns + i;

  const meridiansByRa = groupBy(edges.meridians, (e) => e.raDeg);
  const parallelsByDec = groupBy(edges.parallels, (e) => e.decDeg);

  const cells = new DisjointSet(columns * bands);
  const boundedBy = new Map<number, string[][]>();
  const noteBoundary = (cell: number, edge: MeridianEdge | ParallelEdge) => {
    const pairs = boundedBy.get(cell);
    if (pairs) pairs.push([edge.conA, edge.conB]);
    else boundedBy.set(cell, [[edge.conA, edge.conB]]);
  };

  for (let i = 0; i < columns; i++) {
    const east = (i + 1) % columns;
    const shared = meridiansByRa.get(raBoundsDeg[east]) ?? [];
    for (let j = 0; j < bands; j++) {
      const bandLoDeg = bandEdgesDeg[j];
      const bandHiDeg = bandEdgesDeg[j + 1];
      const wall = shared.find(
        (e) => e.decLoDeg <= bandLoDeg + COORD_EPSILON_DEG
          && e.decHiDeg >= bandHiDeg - COORD_EPSILON_DEG,
      );
      if (!wall) {
        cells.union(cellIndex(i, j), cellIndex(east, j));
      } else {
        noteBoundary(cellIndex(i, j), wall);
        noteBoundary(cellIndex(east, j), wall);
      }
    }
  }

  for (let j = 0; j < bands - 1; j++) {
    const shared = parallelsByDec.get(decBoundsDeg[j]) ?? [];
    for (let i = 0; i < columns; i++) {
      const columnLoDeg = raBoundsDeg[i];
      const columnHiDeg = i + 1 < columns ? raBoundsDeg[i + 1] : raBoundsDeg[0] + 360;
      const wall = shared.find((e) => coversRaColumn(e, columnLoDeg, columnHiDeg));
      if (!wall) {
        cells.union(cellIndex(i, j), cellIndex(i, j + 1));
      } else {
        noteBoundary(cellIndex(i, j), wall);
        noteBoundary(cellIndex(i, j + 1), wall);
      }
    }
  }

  const candidatesByRegion = new Map<number, Set<string>>();
  for (const [cell, pairs] of boundedBy) {
    const region = cells.find(cell);
    let candidates = candidatesByRegion.get(region);
    if (!candidates) {
      candidates = new Set(pairs[0]);
      candidatesByRegion.set(region, candidates);
    }
    for (const pair of pairs) {
      for (const candidate of candidates) {
        if (!pair.includes(candidate)) candidates.delete(candidate);
      }
    }
  }

  const nameByRegion = new Map<number, string>();
  for (let cell = 0; cell < columns * bands; cell++) {
    const region = cells.find(cell);
    if (nameByRegion.has(region)) continue;
    const candidates = candidatesByRegion.get(region);
    if (candidates?.size !== 1) {
      throw new Error(
        `IAU boundary region ${region} resolved to `
        + `${candidates?.size ?? 0} constellations (${[...(candidates ?? [])].join(', ') || 'none'})`,
      );
    }
    nameByRegion.set(region, [...candidates][0]);
  }

  if (nameByRegion.size !== IAU_REGION_COUNT) {
    throw new Error(
      `IAU boundary walk yielded ${nameByRegion.size} regions, expected ${IAU_REGION_COUNT}`,
    );
  }
  const distinct = new Set(nameByRegion.values());
  if (distinct.size !== IAU_REGION_COUNT) {
    throw new Error(
      `IAU boundary regions carry ${distinct.size} distinct names, expected ${IAU_REGION_COUNT}`,
    );
  }

  const cellCon = new Array<string>(columns * bands);
  for (let cell = 0; cell < cellCon.length; cell++) {
    cellCon[cell] = nameByRegion.get(cells.find(cell))!;
  }
  return { raBoundsDeg, decBoundsDeg, cellCon };
}

function lastIndexAtOrBelow(ascending: readonly number[], value: number): number {
  let lo = 0;
  let hi = ascending.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ascending[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** The edge-set code (`AND`, `SER1`, …) covering a position already precessed
 *  to B1875. The boundaries partition the whole sphere, so every position
 *  resolves — catalogued or not. */
export function constellationEdgeCodeAt(
  grid: ConstellationRegionGrid,
  b1875: SkyPosition,
): string {
  const column = lastIndexAtOrBelow(grid.raBoundsDeg, wrapDeg(b1875.raDeg));
  const band = lastIndexAtOrBelow(grid.decBoundsDeg, b1875.decDeg) + 1;
  return grid.cellCon[
    band * grid.raBoundsDeg.length + (column < 0 ? grid.raBoundsDeg.length - 1 : column)
  ];
}

/** Edge-set code → the lowercase key the IAU-88 constellation table is
 *  indexed by. Serpens' two parts collapse onto its single entry. */
export function constellationKey(edgeCode: string): string {
  const key = edgeCode.toLowerCase();
  return key === 'ser1' || key === 'ser2' ? 'ser' : key;
}

function angularSeparationDeg(a: SkyPosition, b: SkyPosition): number {
  const u = unitVectorFromRaDec(a.raDeg, a.decDeg);
  const v = unitVectorFromRaDec(b.raDeg, b.decDeg);
  return Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y + u.z * v.z))) * RAD_TO_DEG;
}

// The perpendicular foot onto a constant-RA great circle does NOT keep the
// point's own declination — it sits at `atan2(sin δ, cos δ·cos Δα)`, which
// leaves ±90° once the point is more than a quarter turn away in RA, putting
// the foot on the antimeridian half of the circle and off this arc entirely.
// Gating on the point's declination instead measures to that far half: it
// reports 0° for a wall 20° away.
function distanceToMeridianDeg(edge: MeridianEdge, at: SkyPosition): number {
  const decRad = at.decDeg * DEG_TO_RAD;
  const deltaRaRad = (at.raDeg - edge.raDeg) * DEG_TO_RAD;
  const cosDec = Math.cos(decRad);
  const footDecDeg = Math.atan2(Math.sin(decRad), cosDec * Math.cos(deltaRaRad)) * RAD_TO_DEG;
  if (footDecDeg >= edge.decLoDeg && footDecDeg <= edge.decHiDeg) {
    const outOfPlane = cosDec * Math.sin(deltaRaRad);
    return Math.abs(Math.asin(Math.max(-1, Math.min(1, outOfPlane))) * RAD_TO_DEG);
  }
  return Math.min(
    angularSeparationDeg(at, { raDeg: edge.raDeg, decDeg: edge.decLoDeg }),
    angularSeparationDeg(at, { raDeg: edge.raDeg, decDeg: edge.decHiDeg }),
  );
}

function distanceToParallelDeg(edge: ParallelEdge, at: SkyPosition): number {
  const spanDeg = parallelSpanDeg(edge);
  const intoArcDeg = wrapDeg(at.raDeg - edge.raStartDeg);
  // Constant dec is a small circle and the shortest path to it runs along the
  // point's own meridian, so an in-span point is |Δdec| away.
  if (intoArcDeg <= spanDeg) return Math.abs(at.decDeg - edge.decDeg);
  const nearerStart = 360 - intoArcDeg <= intoArcDeg - spanDeg;
  return angularSeparationDeg(at, {
    raDeg: nearerStart ? edge.raStartDeg : edge.raEndDeg,
    decDeg: edge.decDeg,
  });
}

/** Angular distance from a B1875 position to the nearest boundary arc. Feeds
 *  the boundary-shell fade window: a star this far inside its own cell wall
 *  tolerates a camera offset of `(this + tolerance) × its distance` before it
 *  reads as sitting in the wrong constellation. */
export function angularDistanceToNearestEdgeDeg(
  edges: IauBoundaryEdges,
  b1875: SkyPosition,
): number {
  let nearest = Infinity;
  for (const edge of edges.meridians) {
    nearest = Math.min(nearest, distanceToMeridianDeg(edge, b1875));
  }
  for (const edge of edges.parallels) {
    nearest = Math.min(nearest, distanceToParallelDeg(edge, b1875));
  }
  return nearest;
}

/** The edge set with the B1875 precession bound in, so callers pass ICRS/J2000
 *  positions. Every method below precesses; the `edges` / `grid` fields are
 *  exposed for the geometry itself and expect B1875 input. */
export interface IauConstellationLookup {
  readonly edges: IauBoundaryEdges;
  readonly grid: ConstellationRegionGrid;
  /** Edge-set code (`AND`, `SER1`, …) for a J2000 position. */
  edgeCodeAt(j2000: SkyPosition): string;
  /** Lowercase IAU-88 table key; Serpens' two parts collapse to `ser`. */
  keyAt(j2000: SkyPosition): string;
  /** Degrees from a J2000 position to the nearest boundary arc. */
  distanceToNearestEdgeDeg(j2000: SkyPosition): number;
}

/** Parses, decomposes, and binds the epoch in one step — the entry point every
 *  consumer outside this module should use. Skipping the precession and
 *  querying a J2000 position against the B1875 grid directly is a silent wrong
 *  answer, not an error: it still resolves, ~1.4° out. */
export function createIauConstellationLookup(
  records: readonly string[],
): IauConstellationLookup {
  const edges = parseIauEdges(records);
  const grid = buildConstellationRegions(edges);
  const toB1875 = precessionRotationFromJ2000(B1875_JD);
  const at = (j2000: SkyPosition) => precessRaDec(toB1875, j2000);
  return {
    edges,
    grid,
    edgeCodeAt: (j2000) => constellationEdgeCodeAt(grid, at(j2000)),
    keyAt: (j2000) => constellationKey(constellationEdgeCodeAt(grid, at(j2000))),
    distanceToNearestEdgeDeg: (j2000) => angularDistanceToNearestEdgeDeg(edges, at(j2000)),
  };
}
