// Cap sums, hole cells and the table they become. Pure. README.md.

import { apparentMagnitude } from '../../src/client/solar-system/perceptual-magnitude';
import {
  ABSOLUTE_MAGNITUDE_DISTANCE_PC,
  fluxNumber,
} from '../../src/client/hdr/emission/density0-solver-pure';
import {
  SOL_GALACTOCENTRIC_PC,
  type Vec3,
  bulgeDensity,
  discDensity,
} from '../../src/client/milkyway/milkyway-column-pure';
import {
  RESOLVED_HOLE_BANDS,
  RESOLVED_HOLE_DEX_PER_SHELL,
  RESOLVED_HOLE_LOG_DISTANCE0,
  RESOLVED_HOLE_SHELLS,
  type ResolvedHoleTable,
  resolvedHoleIndex,
  resolvedHoleShellEdgesPc,
  resolvedLightFraction,
} from '../../src/client/milkyway/calibration/resolved-fraction-pure';
import { ARCSEC_TO_RAD } from '../../src/client/util/astronomy-constants';

/** Parallel columns off a built catalogue, Sol at the origin, ICRS axes. */
export interface StarColumns {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  /** Intrinsic — the build already subtracted the Sol→star A_V. */
  readonly absmag: Float32Array;
  readonly count: number;
}

export const CAP_RADIUS_DEG = 10;

export function capSolidAngleSr(radiusDeg: number): number {
  return 2 * Math.PI * (1 - Math.cos((radiusDeg * Math.PI) / 180));
}

export interface CapSurfaceBrightness {
  /** V mag/arcsec² of the de-extincted catalogue summed inside the cap. */
  readonly magArcsec2: number;
  readonly stars: number;
}

/** De-extincted (`V = absmag + 5·log10(d/10)`) — README.md#what-it-writes. */
export function capSurfaceBrightness(
  stars: StarColumns,
  centreUnit: Vec3,
  radiusDeg = CAP_RADIUS_DEG,
): CapSurfaceBrightness {
  const cosLimit = Math.cos((radiusDeg * Math.PI) / 180);
  let flux = 0;
  let count = 0;
  for (let i = 0; i < stars.count; i++) {
    const x = stars.x[i];
    const y = stars.y[i];
    const z = stars.z[i];
    const d = Math.hypot(x, y, z);
    if (d === 0) continue;
    const cosSep = (x * centreUnit[0] + y * centreUnit[1] + z * centreUnit[2]) / d;
    if (cosSep < cosLimit) continue;
    flux += fluxNumber(apparentMagnitude(stars.absmag[i], d));
    count++;
  }
  const omegaArcsec2 = capSolidAngleSr(radiusDeg) / (ARCSEC_TO_RAD * ARCSEC_TO_RAD);
  return { magArcsec2: -2.5 * Math.log10(flux / omegaArcsec2), stars: count };
}

/** A star's luminosity in the band's flux unit — `d²·F` at the absolute-
 *  magnitude distance, the unit `solveDensity0` puts `density0` in. */
export function starLuminosity(absmag: number): number {
  return ABSOLUTE_MAGNITUDE_DISTANCE_PC ** 2 * fluxNumber(absmag);
}

/** Row-major 3×3, ICRS components in → galactic components out. */
export type Rotation3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

/** Both components' intrinsic emissivity at a galactocentric point. */
export function bandEmissivity(pGal: Vec3): number {
  const rPc = Math.hypot(pGal[0], pGal[1]);
  return discDensity(rPc, pGal[2]) + bulgeDensity(rPc, pGal[2]);
}

/** Unit directions spread evenly over the sphere. */
export function fibonacciSphere(n: number): Vec3[] {
  const out: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const zc = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - zc * zc);
    const phi = i * golden;
    out.push([r * Math.cos(phi), r * Math.sin(phi), zc]);
  }
  return out;
}

export interface ShellQuadrature {
  readonly directions: number;
  readonly radialSteps: number;
}

export const DEFAULT_QUADRATURE: ShellQuadrature = { directions: 8000, radialSteps: 8 };

/** The model's quadrature points inside one cell, each with its distance
 *  from Sol, its |sin b| and the light it stands for. */
export interface CellSamples {
  readonly dSolPc: Float64Array;
  readonly absSinB: Float64Array;
  readonly light: Float64Array;
}

export interface HoleCell {
  readonly shell: number;
  readonly band: number;
  readonly innerPc: number;
  readonly outerPc: number;
  /** Catalogue luminosity in the cell, band flux unit. */
  readonly catalogue: number;
  readonly stars: number;
  /** Band-model luminosity in the same cell, same unit — Σ samples.light. */
  readonly model: number;
  readonly samples: CellSamples;
}

/** Closed form — the shells are a tenth of a dex each from 10 pc. */
function shellIndex(dSolPc: number): number {
  return Math.floor(
    (Math.log10(dSolPc) - RESOLVED_HOLE_LOG_DISTANCE0) / RESOLVED_HOLE_DEX_PER_SHELL,
  );
}

/** Closed form — the bands are equal steps of |sin b|, and |sin b| = 1
 *  would otherwise index one past the last. */
function bandIndex(absSinB: number): number {
  return Math.min(Math.floor(absSinB * RESOLVED_HOLE_BANDS), RESOLVED_HOLE_BANDS - 1);
}

/** On the table's own edges. README.md#how-a-cell-is-measured. */
export function buildHoleCells(
  stars: StarColumns,
  icrsToGal: Rotation3,
  quadrature: ShellQuadrature = DEFAULT_QUADRATURE,
): HoleCell[] {
  const edgesPc = resolvedHoleShellEdgesPc();
  const shells = RESOLVED_HOLE_SHELLS;
  const bands = RESOLVED_HOLE_BANDS;
  const cellOf = (shell: number, band: number) => shell * bands + band;
  const catalogue = new Float64Array(shells * bands);
  const count = new Uint32Array(shells * bands);
  for (let i = 0; i < stars.count; i++) {
    const x = stars.x[i];
    const y = stars.y[i];
    const z = stars.z[i];
    const d = Math.hypot(x, y, z);
    if (d < edgesPc[0] || d >= edgesPc[shells]) continue;
    const zGal = icrsToGal[6] * x + icrsToGal[7] * y + icrsToGal[8] * z;
    const cell = cellOf(shellIndex(d), bandIndex(Math.abs(zGal) / d));
    catalogue[cell] += starLuminosity(stars.absmag[i]);
    count[cell]++;
  }

  const dirs = fibonacciSphere(quadrature.directions);
  const dirBand = dirs.map((dir) => bandIndex(Math.abs(dir[2])));
  const solidAnglePerDir = (4 * Math.PI) / quadrature.directions;

  // Every shell sees the same directions, so one pass over dirBand sizes
  // each cell's sample arrays and they fill without growing.
  const perBand = new Uint32Array(bands);
  for (const b of dirBand) perBand[b] += quadrature.radialSteps;
  const samples: CellSamples[] = [];
  const filled = new Uint32Array(shells * bands);
  for (let s = 0; s < shells; s++) {
    for (let b = 0; b < bands; b++) {
      samples.push({
        dSolPc: new Float64Array(perBand[b]),
        absSinB: new Float64Array(perBand[b]),
        light: new Float64Array(perBand[b]),
      });
    }
  }

  for (let s = 0; s < shells; s++) {
    const dr = (edgesPc[s + 1] - edgesPc[s]) / quadrature.radialSteps;
    for (let j = 0; j < quadrature.radialSteps; j++) {
      const r = edgesPc[s] + (j + 0.5) * dr;
      const volumePerDir = r * r * dr * solidAnglePerDir;
      for (let k = 0; k < dirs.length; k++) {
        const dir = dirs[k];
        const p: Vec3 = [
          SOL_GALACTOCENTRIC_PC[0] + r * dir[0],
          SOL_GALACTOCENTRIC_PC[1] + r * dir[1],
          SOL_GALACTOCENTRIC_PC[2] + r * dir[2],
        ];
        const cell = cellOf(s, dirBand[k]);
        const at = filled[cell]++;
        samples[cell].dSolPc[at] = r;
        samples[cell].absSinB[at] = Math.abs(dir[2]);
        samples[cell].light[at] = bandEmissivity(p) * volumePerDir;
      }
    }
  }

  const cells: HoleCell[] = [];
  for (let s = 0; s < shells; s++) {
    for (let b = 0; b < bands; b++) {
      const c = cellOf(s, b);
      cells.push({
        shell: s,
        band: b,
        innerPc: edgesPc[s],
        outerPc: edgesPc[s + 1],
        catalogue: catalogue[c],
        stars: count[c],
        model: samples[c].light.reduce((sum, v) => sum + v, 0),
        samples: samples[c],
      });
    }
  }
  return cells;
}

/** Both a cell and a shell row carry the two terms of the ratio. */
export function resolvedShare(of: { catalogue: number; model: number }): number {
  return of.model > 0 ? Math.min(of.catalogue / of.model, 1) : 0;
}

/** README.md#how-a-cell-is-measured. */
export const MIN_STARS_PER_CELL = 500;

/** The table the band marches, from cells binned on the table's own edges. */
export function resolvedHoleTableFromCells(cells: readonly HoleCell[]): ResolvedHoleTable {
  const values = new Array<number>(RESOLVED_HOLE_SHELLS * RESOLVED_HOLE_BANDS).fill(0);
  const shellShare = shellTotals(cells).map(resolvedShare);
  for (const c of cells) {
    values[resolvedHoleIndex(c.shell, c.band)] =
      c.stars >= MIN_STARS_PER_CELL ? resolvedShare(c) : shellShare[c.shell];
  }
  return { values };
}

/** The light the table removes from a cell: Σ light · f(d, |sin b|), sampled
 *  the way the shader samples it. */
export function holeLight(cell: HoleCell, table: ResolvedHoleTable): number {
  const { dSolPc, absSinB, light } = cell.samples;
  let sum = 0;
  for (let i = 0; i < light.length; i++) {
    sum += light[i] * resolvedLightFraction(dSolPc[i], absSinB[i], table);
  }
  return sum;
}

/** One all-sky row per shell. Scalars only — the quadrature samples stay
 *  with the cells that own them, and `shellHoleLight` reaches them there. */
export interface ShellTotal {
  readonly shell: number;
  readonly innerPc: number;
  readonly outerPc: number;
  readonly catalogue: number;
  readonly stars: number;
  readonly model: number;
}

export function shellTotals(cells: readonly HoleCell[]): ShellTotal[] {
  const rows: ShellTotal[] = [];
  for (const c of cells) {
    const row = rows[c.shell];
    rows[c.shell] = row === undefined
      ? { shell: c.shell, innerPc: c.innerPc, outerPc: c.outerPc,
        catalogue: c.catalogue, stars: c.stars, model: c.model }
      : { ...row,
        catalogue: row.catalogue + c.catalogue,
        stars: row.stars + c.stars,
        model: row.model + c.model };
  }
  return rows;
}

/** What the table removes from each shell, summed over its bands. */
export function shellHoleLight(
  cells: readonly HoleCell[],
  table: ResolvedHoleTable,
): number[] {
  const out: number[] = [];
  for (const c of cells) out[c.shell] = (out[c.shell] ?? 0) + holeLight(c, table);
  return out;
}
