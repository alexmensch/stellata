// Node-side reader for the Edenhofer voxel chunks in data/dust/, plus the
// cascade's analytic tier — the two dust sources the sweep reads.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GAL_TO_ICRS, R0_PC } from '../../../src/client/galactic/galactic-coords';
import {
  ANALYTICAL_DUST_NORM_PER_PC,
  ANALYTICAL_DUST_SCALE_HEIGHT_PC,
  ANALYTICAL_DUST_SCALE_LENGTH_PC,
  DEFAULT_DUST_AV_PER_DENSITY_PC,
} from '../../../src/client/milkyway/milkyway-column-pure';

export const GRID = 512;
export const BOUNDS_PC = 1250;
export const VOXEL_PC = (2 * BOUNDS_PC) / GRID;
/** Cascade domain: the doc's 1.25 kpc coverage sphere, not the cube. */
export const COVERAGE_RADIUS_PC = 1250;

const DENSITY_MIN = 1e-7;
const DENSITY_MAX = 0.2;

const DECODE = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  DECODE[i] = DENSITY_MIN * Math.pow(DENSITY_MAX / DENSITY_MIN, i / 255);
}

export function loadGrid(root: string): Uint8Array {
  const grid = new Uint8Array(GRID * GRID * GRID);
  const chunk = 128;
  for (let ix = 0; ix < 4; ix++) {
    for (let iy = 0; iy < 4; iy++) {
      for (let iz = 0; iz < 4; iz++) {
        const buf = readFileSync(
          resolve(root, `data/dust/chunk_${ix}_${iy}_${iz}.bin`),
        );
        for (let lz = 0; lz < chunk; lz++) {
          const gz = iz * chunk + lz;
          for (let ly = 0; ly < chunk; ly++) {
            const gy = iy * chunk + ly;
            const src = (lz * chunk + ly) * chunk;
            const dst = (gz * GRID + gy) * GRID + ix * chunk;
            for (let lx = 0; lx < chunk; lx++) grid[dst + lx] = buf[src + lx];
          }
        }
      }
    }
  }
  return grid;
}

/**
 * Trilinear density at a heliocentric ICRS point, in E_ZGR/pc. Filters the
 * DECODED values; the GPU filters the u8-log codes, which is a geometric
 * mean and under-reads a gradient — noted in the writeup, not mirrored.
 */
export function densityAt(
  grid: Uint8Array,
  x: number,
  y: number,
  z: number,
): number {
  const cx = ((x + BOUNDS_PC) / VOXEL_PC) - 0.5;
  const cy = ((y + BOUNDS_PC) / VOXEL_PC) - 0.5;
  const cz = ((z + BOUNDS_PC) / VOXEL_PC) - 0.5;
  if (
    cx < -0.5 || cx > GRID - 0.5 ||
    cy < -0.5 || cy > GRID - 0.5 ||
    cz < -0.5 || cz > GRID - 0.5
  ) return 0;
  const x0 = Math.max(0, Math.min(GRID - 1, Math.floor(cx)));
  const y0 = Math.max(0, Math.min(GRID - 1, Math.floor(cy)));
  const z0 = Math.max(0, Math.min(GRID - 1, Math.floor(cz)));
  const x1 = Math.min(GRID - 1, x0 + 1);
  const y1 = Math.min(GRID - 1, y0 + 1);
  const z1 = Math.min(GRID - 1, z0 + 1);
  const fx = Math.max(0, Math.min(1, cx - x0));
  const fy = Math.max(0, Math.min(1, cy - y0));
  const fz = Math.max(0, Math.min(1, cz - z0));

  const r0 = (z0 * GRID + y0) * GRID;
  const r1 = (z0 * GRID + y1) * GRID;
  const r2 = (z1 * GRID + y0) * GRID;
  const r3 = (z1 * GRID + y1) * GRID;
  const d000 = DECODE[grid[r0 + x0]];
  const d100 = DECODE[grid[r0 + x1]];
  const d010 = DECODE[grid[r1 + x0]];
  const d110 = DECODE[grid[r1 + x1]];
  const d001 = DECODE[grid[r2 + x0]];
  const d101 = DECODE[grid[r2 + x1]];
  const d011 = DECODE[grid[r3 + x0]];
  const d111 = DECODE[grid[r3 + x1]];

  const a = d000 + (d100 - d000) * fx;
  const b = d010 + (d110 - d010) * fx;
  const c = d001 + (d101 - d001) * fx;
  const d = d011 + (d111 - d011) * fx;
  const e = a + (b - a) * fy;
  const f = c + (d - c) * fy;
  return e + (f - e) * fz;
}

// --- Frames ------------------------------------------------------------

const GAL_TO_ICRS_M3 = new THREE.Matrix3().setFromMatrix4(GAL_TO_ICRS);

/** Galactocentric galactic pc → heliocentric ICRS pc. */
export function galToIcrs(out: THREE.Vector3, gx: number, gy: number, gz: number): THREE.Vector3 {
  return out.set(gx + R0_PC, gy, gz).applyMatrix3(GAL_TO_ICRS_M3);
}

export function analyticAvPerPc(rPc: number, zPc: number): number {
  return (
    ANALYTICAL_DUST_NORM_PER_PC *
    Math.exp(-(rPc - R0_PC) / ANALYTICAL_DUST_SCALE_LENGTH_PC) *
    Math.exp(-Math.abs(zPc) / ANALYTICAL_DUST_SCALE_HEIGHT_PC) *
    DEFAULT_DUST_AV_PER_DENSITY_PC
  );
}

/**
 * The cascade's A_V per pc at a galactocentric point: measured grid inside
 * the coverage sphere, analytic slab outside it, never both.
 */
export function cascadeAvPerPc(
  grid: Uint8Array,
  scratch: THREE.Vector3,
  gx: number,
  gy: number,
  gz: number,
): number {
  const p = galToIcrs(scratch, gx, gy, gz);
  if (p.lengthSq() <= COVERAGE_RADIUS_PC * COVERAGE_RADIUS_PC) {
    return densityAt(grid, p.x, p.y, p.z) * DEFAULT_DUST_AV_PER_DENSITY_PC;
  }
  return analyticAvPerPc(Math.hypot(gx, gy), gz);
}
