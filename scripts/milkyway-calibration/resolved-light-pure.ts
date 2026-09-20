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
  RESOLVED_HOLE_SHELLS,
  type ResolvedHoleTable,
  resolvedHoleBandEdges,
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

/** De-extincted (`V = absmag + 5·log10(d/10)`) — README.md § What it writes. */
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

function edgeIndex(value: number, edges: readonly number[]): number {
  let i = 0;
  while (i < edges.length - 2 && value >= edges[i + 1]) i++;
  return i;
}

/** The table's own cells by default. README.md § How a cell is measured. */
export function buildHoleCells(
  stars: StarColumns,
  icrsToGal: Rotation3,
  edgesPc: readonly number[] = resolvedHoleShellEdgesPc(),
  bandEdges: readonly number[] = resolvedHoleBandEdges(),
  quadrature: ShellQuadrature = DEFAULT_QUADRATURE,
): HoleCell[] {
  const shells = edgesPc.length - 1;
  const bands = bandEdges.length - 1;
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
    const cell = cellOf(edgeIndex(d, edgesPc), edgeIndex(Math.abs(zGal) / d, bandEdges));
    catalogue[cell] += starLuminosity(stars.absmag[i]);
    count[cell]++;
  }

  const dirs = fibonacciSphere(quadrature.directions);
  const dirBand = dirs.map((dir) => edgeIndex(Math.abs(dir[2]), bandEdges));
  const solidAnglePerDir = (4 * Math.PI) / quadrature.directions;
  const samples = Array.from({ length: shells * bands }, () => ({
    d: [] as number[],
    sinB: [] as number[],
    w: [] as number[],
  }));
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
        const cell = samples[cellOf(s, dirBand[k])];
        cell.d.push(r);
        cell.sinB.push(Math.abs(dir[2]));
        cell.w.push(bandEmissivity(p) * volumePerDir);
      }
    }
  }

  const cells: HoleCell[] = [];
  for (let s = 0; s < shells; s++) {
    for (let b = 0; b < bands; b++) {
      const c = cellOf(s, b);
      const light = Float64Array.from(samples[c].w);
      cells.push({
        shell: s,
        band: b,
        innerPc: edgesPc[s],
        outerPc: edgesPc[s + 1],
        catalogue: catalogue[c],
        stars: count[c],
        model: light.reduce((sum, v) => sum + v, 0),
        samples: {
          dSolPc: Float64Array.from(samples[c].d),
          absSinB: Float64Array.from(samples[c].sinB),
          light,
        },
      });
    }
  }
  return cells;
}

export function resolvedShare(cell: HoleCell): number {
  return cell.model > 0 ? Math.min(cell.catalogue / cell.model, 1) : 0;
}

/** README.md § How a cell is measured. */
export const MIN_STARS_PER_CELL = 500;

/** The table the band marches, from cells binned on the table's own edges. */
export function resolvedHoleTableFromCells(cells: readonly HoleCell[]): ResolvedHoleTable {
  const values = new Array<number>(RESOLVED_HOLE_SHELLS * RESOLVED_HOLE_BANDS).fill(0);
  const shellShare = new Map(sumOverBands(cells).map((s) => [s.shell, resolvedShare(s)]));
  for (const c of cells) {
    values[resolvedHoleIndex(c.shell, c.band)] =
      c.stars >= MIN_STARS_PER_CELL ? resolvedShare(c) : shellShare.get(c.shell)!;
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

/** Cells summed over latitude into one row per shell. */
export function sumOverBands(cells: readonly HoleCell[]): HoleCell[] {
  const byShell = new Map<number, HoleCell[]>();
  for (const c of cells) byShell.set(c.shell, [...(byShell.get(c.shell) ?? []), c]);
  return [...byShell.values()].map((group) => {
    const concat = (pick: (s: CellSamples) => Float64Array) => {
      const out = new Float64Array(group.reduce((n, c) => n + pick(c.samples).length, 0));
      let at = 0;
      for (const c of group) {
        out.set(pick(c.samples), at);
        at += pick(c.samples).length;
      }
      return out;
    };
    return {
      ...group[0],
      band: 0,
      catalogue: group.reduce((s, c) => s + c.catalogue, 0),
      stars: group.reduce((s, c) => s + c.stars, 0),
      model: group.reduce((s, c) => s + c.model, 0),
      samples: {
        dSolPc: concat((s) => s.dSolPc),
        absSinB: concat((s) => s.absSinB),
        light: concat((s) => s.light),
      },
    };
  });
}
