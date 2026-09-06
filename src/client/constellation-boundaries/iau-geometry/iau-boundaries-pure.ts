// The IAU (Delporte 1930) constellation boundary edge set at equinox B1875,
// its decomposition into named regions, and positional lookup against them.
// See README.md.

import { RA_HOURS_TO_DEG } from '../../util/astronomy-constants';
import {
  raDecFromUnitVector,
  unitVectorFromRaDec,
  type SkyPosition,
  type UnitVector,
} from '../../util/equatorial-basis';
import {
  B1875_JD,
  precessRaDec,
  precessionRotationFromJ2000,
  unprecessDirection,
} from '../../util/precession';

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

/** Dec band edges of a grid: the distinct edge declinations with ±90 closing
 *  the outermost bands, so band `j` spans `[out[j], out[j + 1]]`. */
function bandEdgesDeg(decBoundsDeg: readonly number[]): number[] {
  return [-90, ...decBoundsDeg, 90];
}

/** Eastern RA bound of column `i`. The last column wraps past RA 0, so its
 *  bound is the first bound plus a turn, never `raBoundsDeg[0]`. */
function columnHiDeg(raBoundsDeg: readonly number[], i: number): number {
  return i + 1 < raBoundsDeg.length ? raBoundsDeg[i + 1] : raBoundsDeg[0] + 360;
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
  const bandEdges = bandEdgesDeg(decBoundsDeg);
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
      const bandLoDeg = bandEdges[j];
      const bandHiDeg = bandEdges[j + 1];
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
      const wall = shared.find(
        (e) => coversRaColumn(e, raBoundsDeg[i], columnHiDeg(raBoundsDeg, i)),
      );
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

const STERADIAN_TO_SQUARE_DEG = RAD_TO_DEG * RAD_TO_DEG;

/** 41252.96. The regions partition the sphere, so their areas close on it —
 *  derived rather than typed in, so the closure check tests the decomposition
 *  and not a transcription. */
export const FULL_SPHERE_SQUARE_DEG = 4 * Math.PI * STERADIAN_TO_SQUARE_DEG;

/** Where a region's name is written on the chart, and how much sky it covers. */
export interface RegionLabelAnchor {
  /** Edge-set code, so Serpens contributes two anchors (`SER1`, `SER2`). */
  code: string;
  /** ICRS direction of the region's centre of mass at equal surface weight. */
  direction: UnitVector;
  areaSquareDeg: number;
}

/** Equal-surface-weight centre of mass of every region, in ICRS.
 *
 *  Each cell is a spherical rectangle in B1875, so its area and its integral
 *  of the unit direction both close in elementary functions — no sampling, and
 *  the vector sum over a region's cells is exactly its centre of mass. A
 *  region's emitted area reproduces the published IAU constellation area,
 *  which is what makes this an externally checkable quantity rather than an
 *  internal one.
 *
 *  **Every anchor is asserted to land inside its own region**, and the walk
 *  throws rather than emit one that doesn't: a centre of mass is only
 *  guaranteed inside a convex region, and the flux-weighted centroid this
 *  replaces put Serpens' label in Ophiuchus. Splitting Serpens into SER1/SER2
 *  is what keeps that true here — a single Serpens anchor would fail the
 *  assertion, not slip past it. */
export function buildRegionLabelAnchors(
  grid: ConstellationRegionGrid,
): RegionLabelAnchor[] {
  const columns = grid.raBoundsDeg.length;
  const bandEdges = bandEdgesDeg(grid.decBoundsDeg);
  const sums = new Map<string, { x: number; y: number; z: number; areaSr: number }>();

  for (let j = 0; j < bandEdges.length - 1; j++) {
    const decLoRad = bandEdges[j] * DEG_TO_RAD;
    const decHiRad = bandEdges[j + 1] * DEG_TO_RAD;
    const sinLo = Math.sin(decLoRad);
    const sinHi = Math.sin(decHiRad);
    // ∫cos²δ dδ and ∫sinδ·cosδ dδ across the band — the declination halves of
    // ∫∫ û cos δ dδ dα, whose α halves depend only on the column.
    const intCosSq = (decHiRad / 2 + Math.sin(2 * decHiRad) / 4)
      - (decLoRad / 2 + Math.sin(2 * decLoRad) / 4);
    const intSinCos = (sinHi * sinHi - sinLo * sinLo) / 2;
    for (let i = 0; i < columns; i++) {
      const raLoRad = grid.raBoundsDeg[i] * DEG_TO_RAD;
      const raHiRad = columnHiDeg(grid.raBoundsDeg, i) * DEG_TO_RAD;
      const code = grid.cellCon[j * columns + i];
      let sum = sums.get(code);
      if (!sum) {
        sum = { x: 0, y: 0, z: 0, areaSr: 0 };
        sums.set(code, sum);
      }
      sum.x += (Math.sin(raHiRad) - Math.sin(raLoRad)) * intCosSq;
      sum.y += (Math.cos(raLoRad) - Math.cos(raHiRad)) * intCosSq;
      sum.z += (raHiRad - raLoRad) * intSinCos;
      sum.areaSr += (raHiRad - raLoRad) * (sinHi - sinLo);
    }
  }

  const toB1875 = precessionRotationFromJ2000(B1875_JD);
  const anchors: RegionLabelAnchor[] = [];
  for (const [code, sum] of [...sums].sort(([a], [b]) => a.localeCompare(b))) {
    const length = Math.hypot(sum.x, sum.y, sum.z);
    const b1875 = { x: sum.x / length, y: sum.y / length, z: sum.z / length };
    const at = constellationEdgeCodeAt(grid, raDecFromUnitVector(b1875));
    if (at !== code) {
      throw new Error(
        `IAU region ${code}'s area-weighted centre of mass falls in ${at}`,
      );
    }
    anchors.push({
      code,
      direction: unprecessDirection(toB1875, b1875),
      areaSquareDeg: sum.areaSr * STERADIAN_TO_SQUARE_DEG,
    });
  }
  return anchors;
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

/** Angular distance from a B1875 position to the nearest boundary arc, by
 *  linear scan. The reference implementation `createNearestEdgeIndex` is
 *  pinned against; `createIauConstellationLookup` uses the index. */
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

/** A boundary arc resampled into ICRS unit directions, in arc order. */
export interface BoundaryPolyline {
  /** `M` for a constant-RA meridian, `P` for a constant-Dec parallel. */
  kind: 'M' | 'P';
  conA: string;
  conB: string;
  directions: UnitVector[];
}

/** Every sample within this much of its neighbours along the arc. A chord this
 *  long departs from the sphere by `(step²/8)` radians ≈ 2″ of sky as seen
 *  from the centre, well under a pixel at any chart-mode framing. */
export const POLYLINE_MAX_STEP_DEG = 0.5;

function meridianSampleAt(edge: MeridianEdge, t: number): SkyPosition {
  return { raDeg: edge.raDeg, decDeg: edge.decLoDeg + t * (edge.decHiDeg - edge.decLoDeg) };
}

function parallelSampleAt(edge: ParallelEdge, t: number): SkyPosition {
  return { raDeg: wrapDeg(edge.raStartDeg + t * parallelSpanDeg(edge)), decDeg: edge.decDeg };
}

function sampleCount(arcLengthDeg: number): number {
  return Math.max(2, Math.ceil(arcLengthDeg / POLYLINE_MAX_STEP_DEG) + 1);
}

function resample(
  count: number,
  at: (t: number) => SkyPosition,
  toJ2000: (v: UnitVector) => UnitVector,
): UnitVector[] {
  const out: UnitVector[] = [];
  for (let i = 0; i < count; i++) {
    const { raDeg, decDeg } = at(i / (count - 1));
    out.push(toJ2000(unitVectorFromRaDec(raDeg, decDeg)));
  }
  return out;
}

/** Resamples every arc along its own B1875 geometry, then carries each sample
 *  to ICRS. **Subdividing is not an optimisation.** A constant-Dec arc is a
 *  SMALL circle, which precession maps to neither a straight line nor a great
 *  circle, so a two-endpoint parallel renders as a chord cutting up to a
 *  degree inside the true boundary. Meridians are great circles and precession
 *  is a pure rotation, so they would survive two endpoints — they subdivide
 *  anyway to keep one code path and a uniform tessellation.
 *
 *  Each arc appears exactly once in the edge set with both its neighbours
 *  named, so the flat list is already deduped: there are no per-constellation
 *  polygons to build and no shared arc drawn twice. */
export function buildBoundaryPolylines(edges: IauBoundaryEdges): BoundaryPolyline[] {
  const toB1875 = precessionRotationFromJ2000(B1875_JD);
  const toIcrs = (v: UnitVector) => unprecessDirection(toB1875, v);
  const out: BoundaryPolyline[] = [];
  for (const edge of edges.meridians) {
    const count = sampleCount(edge.decHiDeg - edge.decLoDeg);
    out.push({
      kind: 'M',
      conA: edge.conA,
      conB: edge.conB,
      directions: resample(count, (t) => meridianSampleAt(edge, t), toIcrs),
    });
  }
  for (const edge of edges.parallels) {
    const arcLengthDeg = parallelSpanDeg(edge) * Math.cos(edge.decDeg * DEG_TO_RAD);
    out.push({
      kind: 'P',
      conA: edge.conA,
      conB: edge.conB,
      directions: resample(sampleCount(arcLengthDeg), (t) => parallelSampleAt(edge, t), toIcrs),
    });
  }
  return out;
}

/** Nearest-boundary distance for a B1875 position. Same answer as
 *  `angularDistanceToNearestEdgeDeg`, which scans all 781 arcs with 2–4 trig
 *  calls each — a catalogue sweep is ~380k × 781 of those. */
export interface NearestEdgeIndex {
  distanceDeg(b1875: SkyPosition): number;
}

/** Declination band width of the pruning index. Any point on an arc lies
 *  within the arc's own declination range, and angular separation is at least
 *  the declination difference, so a band's distance from the query's band is a
 *  valid lower bound on every arc bucketed there — once it exceeds the best
 *  distance found so far, no remaining band can improve on it. */
const NEAREST_EDGE_BAND_DEG = 1;

/** Buckets the edge set by declination band so a per-star sweep prunes instead
 *  of scanning every arc. Answers exactly what
 *  `angularDistanceToNearestEdgeDeg` answers — the bound above is a lower
 *  bound, never an approximation. */
export function createNearestEdgeIndex(edges: IauBoundaryEdges): NearestEdgeIndex {
  const bandCount = Math.ceil(180 / NEAREST_EDGE_BAND_DEG);
  const bandOf = (decDeg: number) => Math.min(
    bandCount - 1,
    Math.max(0, Math.floor((decDeg + 90) / NEAREST_EDGE_BAND_DEG)),
  );
  // Meridians take ids [0, meridians.length), parallels the rest, so the
  // per-arc dispatch is one comparison rather than 781 stored closures.
  const meridianCount = edges.meridians.length;
  const arcCount = meridianCount + edges.parallels.length;
  const bands: number[][] = Array.from({ length: bandCount }, () => []);
  const bucket = (id: number, loDeg: number, hiDeg: number) => {
    for (let band = bandOf(loDeg); band <= bandOf(hiDeg); band++) bands[band].push(id);
  };
  edges.meridians.forEach((e, i) => bucket(i, e.decLoDeg, e.decHiDeg));
  edges.parallels.forEach((e, i) => bucket(meridianCount + i, e.decDeg, e.decDeg));
  const distanceOf = (id: number, at: SkyPosition): number => (
    id < meridianCount
      ? distanceToMeridianDeg(edges.meridians[id], at)
      : distanceToParallelDeg(edges.parallels[id - meridianCount], at)
  );

  // An arc spanning several bands is reachable from several rounds; the stamp
  // keeps it to one evaluation per query without reallocating a Set each time.
  const stamp = new Int32Array(arcCount).fill(-1);
  let query = 0;

  return {
    distanceDeg(b1875) {
      const home = bandOf(b1875.decDeg);
      const q = query++;
      let nearest = Infinity;
      for (let step = 0; step <= bandCount; step++) {
        // A band `step` away shares an edge with the query's band at
        // `step − 1` bands of declination, so that is the lower bound.
        if (step > 1 && (step - 1) * NEAREST_EDGE_BAND_DEG >= nearest) break;
        let anyBand = false;
        for (const band of step === 0 ? [home] : [home - step, home + step]) {
          if (band < 0 || band >= bandCount) continue;
          anyBand = true;
          for (const id of bands[band]) {
            if (stamp[id] === q) continue;
            stamp[id] = q;
            nearest = Math.min(nearest, distanceOf(id, b1875));
          }
        }
        if (!anyBand) break;
      }
      return nearest;
    },
  };
}

/** Membership over a region grid with the B1875 precession bound in, so
 *  callers pass ICRS/J2000 positions. This is the half of the lookup that
 *  needs no edge set, which is what lets a browser consumer have it from the
 *  shipped artifact's grid (§ How each consumer gets this). */
export interface GridConstellationLookup {
  /** Edge-set code (`AND`, `SER1`, …) for a J2000 position. */
  edgeCodeAt(j2000: SkyPosition): string;
  /** Lowercase IAU-88 table key; Serpens' two parts collapse to `ser`. */
  keyAt(j2000: SkyPosition): string;
}

export function createGridConstellationLookup(
  grid: ConstellationRegionGrid,
): GridConstellationLookup {
  const toB1875 = precessionRotationFromJ2000(B1875_JD);
  const codeAt = (j2000: SkyPosition) => constellationEdgeCodeAt(grid, precessRaDec(toB1875, j2000));
  return { edgeCodeAt: codeAt, keyAt: (j2000) => constellationKey(codeAt(j2000)) };
}

/** The edge set with the B1875 precession bound in. Every method precesses;
 *  the `edges` / `grid` fields are exposed for the geometry itself and expect
 *  B1875 input. */
export interface IauConstellationLookup extends GridConstellationLookup {
  readonly edges: IauBoundaryEdges;
  readonly grid: ConstellationRegionGrid;
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
  const nearestEdge = createNearestEdgeIndex(edges);
  const toB1875 = precessionRotationFromJ2000(B1875_JD);
  return {
    edges,
    grid,
    ...createGridConstellationLookup(grid),
    distanceToNearestEdgeDeg: (j2000) => nearestEdge.distanceDeg(precessRaDec(toB1875, j2000)),
  };
}
