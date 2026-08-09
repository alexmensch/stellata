// Froxel-grid emulation: a cumulative measured-A_V column per (sky cell,
// log-distance slice), read back by the band march. Both candidate
// parameterisations are this one structure — README.md.

import * as THREE from 'three';
import {
  analyticAvPerPc,
  cascadeAvPerPc,
  COVERAGE_RADIUS_PC,
  densityAt,
  galToIcrs,
  VOXEL_PC,
} from './dust-grid';
import { DEFAULT_DUST_AV_PER_DENSITY_PC } from '../../../src/client/milkyway/milkyway-column-pure';

/** Reference integration step inside coverage: a quarter voxel. */
export const TRUTH_STEP_PC = VOXEL_PC / 4;

export interface Ray {
  readonly o: THREE.Vector3;
  readonly u: THREE.Vector3;
}

export interface Coverage {
  readonly hit: boolean;
  readonly sIn: number;
  readonly sOut: number;
}

const tmpO = new THREE.Vector3();
const tmpU = new THREE.Vector3();
const tmpP = new THREE.Vector3();

/** Entry / exit distances where a ray crosses the 1.25 kpc coverage sphere. */
export function coverageSpan(ray: Ray): Coverage {
  const o = galToIcrs(tmpO, ray.o.x, ray.o.y, ray.o.z);
  const u = galToIcrs(tmpU, ray.o.x + ray.u.x, ray.o.y + ray.u.y, ray.o.z + ray.u.z).sub(o);
  const b = o.dot(u);
  const c = o.lengthSq() - COVERAGE_RADIUS_PC * COVERAGE_RADIUS_PC;
  const disc = b * b - c;
  if (disc <= 0) return { hit: false, sIn: 0, sOut: 0 };
  const root = Math.sqrt(disc);
  const sOut = -b + root;
  if (sOut <= 0) return { hit: false, sIn: 0, sOut: 0 };
  return { hit: true, sIn: Math.max(-b - root, 0), sOut };
}

/** Measured A_V between two distances, integrated at TRUTH_STEP_PC. */
export function measuredColumn(grid: Uint8Array, ray: Ray, sa: number, sb: number): number {
  if (sb <= sa) return 0;
  const n = Math.max(1, Math.ceil((sb - sa) / TRUTH_STEP_PC));
  const ds = (sb - sa) / n;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const s = sa + (i + 0.5) * ds;
    const p = galToIcrs(
      tmpP,
      ray.o.x + s * ray.u.x,
      ray.o.y + s * ray.u.y,
      ray.o.z + s * ray.u.z,
    );
    acc += densityAt(grid, p.x, p.y, p.z);
  }
  return acc * ds * DEFAULT_DUST_AV_PER_DENSITY_PC;
}

/** Measured A_V over a segment, clipped to the coverage span. */
export function truthMeasuredAv(
  grid: Uint8Array,
  ray: Ray,
  cov: Coverage,
  sa: number,
  sb: number,
): number {
  if (!cov.hit) return 0;
  const a = Math.max(sa, cov.sIn);
  const b = Math.min(sb, cov.sOut);
  return b > a ? measuredColumn(grid, ray, a, b) : 0;
}

const ANALYTIC_SUBSTEPS_PER_SCALE_HEIGHT = 2;

/** Slab A_V over the parts of a segment that fall outside coverage. */
export function analyticAv(ray: Ray, cov: Coverage, sa: number, sb: number): number {
  let acc = 0;
  for (const [a, b] of analyticSpans(cov, sa, sb)) {
    const n = Math.max(
      1,
      Math.min(512, Math.ceil(((b - a) / 125) * ANALYTIC_SUBSTEPS_PER_SCALE_HEIGHT)),
    );
    const ds = (b - a) / n;
    for (let i = 0; i < n; i++) {
      const s = a + (i + 0.5) * ds;
      acc +=
        analyticAvPerPc(
          Math.hypot(ray.o.x + s * ray.u.x, ray.o.y + s * ray.u.y),
          ray.o.z + s * ray.u.z,
        ) * ds;
    }
  }
  return acc;
}

function* analyticSpans(cov: Coverage, sa: number, sb: number): Generator<[number, number]> {
  if (sb <= sa) return;
  if (!cov.hit) {
    yield [sa, sb];
    return;
  }
  if (sa < Math.min(sb, cov.sIn)) yield [sa, Math.min(sb, cov.sIn)];
  if (Math.max(sa, cov.sOut) < sb) yield [Math.max(sa, cov.sOut), sb];
}

/**
 * No prefilter: the march samples the cascade directly, `sub` midpoint samples
 * per step. sub = 1 is what the shipped march would do if it simply read the
 * grid; higher values are the brute-force alternative to a prefilter.
 */
export function directTotalAv(
  grid: Uint8Array,
  ray: Ray,
  sa: number,
  sb: number,
  sub: number,
): number {
  if (sb <= sa) return 0;
  const ds = (sb - sa) / sub;
  let acc = 0;
  for (let i = 0; i < sub; i++) {
    const s = sa + (i + 0.5) * ds;
    acc += cascadeAvPerPc(
      grid,
      tmpP,
      ray.o.x + s * ray.u.x,
      ray.o.y + s * ray.u.y,
      ray.o.z + s * ray.u.z,
    );
  }
  return acc * ds;
}

// --- The froxel grid ---------------------------------------------------

export interface FroxelConfig {
  /** Sky cell angular size, radians. */
  readonly cellRad: number;
  /** Log-distance slices across the coverage span. */
  readonly slices: number;
  /** Grid phase in cell units, [0,1)². A sky-fixed grid holds one value; a
   *  screen-space grid slides it under rotation, so the spread across phase
   *  is that grid's frame-to-frame shimmer. */
  readonly phase: readonly [number, number];
  /** Rays averaged per cell per axis — the transverse box filter. 1 = a bare
   *  point sample in angle, which is not a prefilter at all. */
  readonly supersample: number;
}

interface CellCurve {
  readonly sIn: number;
  readonly sOut: number;
  /** Cumulative measured A_V at each slice boundary, slices + 1 entries. */
  readonly cum: Float64Array;
}

const S_FLOOR_PC = 1;

/**
 * The froxel cells covering one small patch of sky, built on demand. Cells are
 * indexed in the tangent plane of the patch centre, so a 13' patch reuses the
 * same handful of cells across all its samples — which is also what makes the
 * fill cost per cell, not per read.
 */
export class LocalFroxel {
  private readonly cells = new Map<number, CellCurve>();
  private readonly e1: THREE.Vector3;
  private readonly e2: THREE.Vector3;
  private built = 0;

  constructor(
    private readonly grid: Uint8Array,
    private readonly origin: THREE.Vector3,
    private readonly centre: THREE.Vector3,
    private readonly cfg: FroxelConfig,
  ) {
    [this.e1, this.e2] = tangentBasis(centre);
  }

  get cellsBuilt(): number {
    return this.built;
  }

  private cell(i: number, j: number): CellCurve {
    const key = (i + 512) * 1024 + (j + 512);
    const hit = this.cells.get(key);
    if (hit !== undefined) return hit;
    const { cellRad, slices, phase, supersample: ss } = this.cfg;
    const cum = new Float64Array(slices + 1);
    let sIn = 0;
    let sOut = 0;
    for (let a = 0; a < ss; a++) {
      for (let b = 0; b < ss; b++) {
        const ox = (i + phase[0] + (a + 0.5) / ss - 0.5) * cellRad;
        const oy = (j + phase[1] + (b + 0.5) / ss - 0.5) * cellRad;
        const dir = new THREE.Vector3()
          .copy(this.centre)
          .addScaledVector(this.e1, ox)
          .addScaledVector(this.e2, oy)
          .normalize();
        const c = buildCellCurve(this.grid, this.origin, dir, slices);
        for (let k = 0; k <= slices; k++) cum[k] += c.cum[k] / (ss * ss);
        sIn += c.sIn / (ss * ss);
        sOut += c.sOut / (ss * ss);
        this.built++;
      }
    }
    const curve: CellCurve = { sIn, sOut, cum };
    this.cells.set(key, curve);
    return curve;
  }

  /** Cumulative measured A_V to distance s along a direction in this patch. */
  cumulative(dir: THREE.Vector3, s: number): number {
    const tx = dir.dot(this.e1) / this.cfg.cellRad - this.cfg.phase[0];
    const ty = dir.dot(this.e2) / this.cfg.cellRad - this.cfg.phase[1];
    const i0 = Math.floor(tx);
    const j0 = Math.floor(ty);
    const fx = tx - i0;
    const fy = ty - j0;
    const { slices } = this.cfg;
    return (
      (1 - fx) * (1 - fy) * readCurve(this.cell(i0, j0), s, slices) +
      fx * (1 - fy) * readCurve(this.cell(i0 + 1, j0), s, slices) +
      (1 - fx) * fy * readCurve(this.cell(i0, j0 + 1), s, slices) +
      fx * fy * readCurve(this.cell(i0 + 1, j0 + 1), s, slices)
    );
  }

  measuredAv(dir: THREE.Vector3, sa: number, sb: number): number {
    return this.cumulative(dir, sb) - this.cumulative(dir, sa);
  }
}

function buildCellCurve(
  grid: Uint8Array,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  slices: number,
): CellCurve {
  const ray: Ray = { o: origin, u: dir };
  const cov = coverageSpan(ray);
  const cum = new Float64Array(slices + 1);
  if (!cov.hit) return { sIn: 0, sOut: 0, cum };
  const sIn = Math.max(cov.sIn, S_FLOOR_PC);
  const sOut = Math.max(cov.sOut, sIn * 1.000001);
  const logIn = Math.log(sIn);
  const logStep = (Math.log(sOut) - logIn) / slices;
  let prev = sIn;
  for (let k = 1; k <= slices; k++) {
    const s = Math.exp(logIn + k * logStep);
    cum[k] = cum[k - 1] + measuredColumn(grid, ray, prev, s);
    prev = s;
  }
  return { sIn, sOut, cum };
}

function readCurve(curve: CellCurve, s: number, slices: number): number {
  if (curve.sOut <= curve.sIn) return 0;
  if (s <= curve.sIn) return 0;
  if (s >= curve.sOut) return curve.cum[slices];
  const logIn = Math.log(curve.sIn);
  const logStep = (Math.log(curve.sOut) - logIn) / slices;
  const t = (Math.log(s) - logIn) / logStep;
  const k = Math.min(slices - 1, Math.floor(t));
  return curve.cum[k] + (curve.cum[k + 1] - curve.cum[k]) * (t - k);
}

export function tangentBasis(u: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const seed = Math.abs(u.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const e1 = new THREE.Vector3().crossVectors(seed, u).normalize();
  const e2 = new THREE.Vector3().crossVectors(u, e1).normalize();
  return [e1, e2];
}
