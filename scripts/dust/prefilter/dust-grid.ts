// Node-side reader for the Edenhofer voxel chunks in data/dust/, plus the
// cascade's analytic tier — the two dust sources the sweep reads. Grid
// geometry and the log-window decode come from the manifest beside the chunks.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GAL_TO_ICRS, R0_PC } from '../../../src/client/galactic/galactic-coords';
import {
  ANALYTICAL_DUST_NORM_PER_PC,
  ANALYTICAL_DUST_SCALE_HEIGHT_PC,
  ANALYTICAL_DUST_SCALE_LENGTH_PC,
} from '../../../src/client/milkyway/milkyway-column-pure';

export interface DustParams {
  readonly gridSize: number;
  readonly chunkSize: number;
  readonly chunksPerAxis: number;
  readonly boundsHalfPc: number;
  readonly voxelPc: number;
  readonly densityMin: number;
  readonly densityMax: number;
  readonly avPerDensityPerPc: number;
}

export interface DustField {
  readonly params: DustParams;
  readonly voxels: Uint8Array;
  /** u8 code → density, in E_ZGR/pc. */
  readonly decode: Float64Array;
}

/**
 * The cascade's measured domain is the coverage SPHERE inscribed in the data
 * cube, not the cube: its corners carry data the contract does not claim, and
 * the entry/exit distances the read needs are the sphere's roots.
 */
export function coverageRadiusPc(params: DustParams): number {
  return params.boundsHalfPc;
}

export function loadDustParams(root: string): DustParams {
  const manifest = JSON.parse(
    readFileSync(resolve(root, 'data/dust/manifest.json'), 'utf8'),
  ) as {
    gridSize: number;
    chunkSize: number;
    chunksPerAxis: number;
    boundsPc: [number, number];
    voxelSizePc: number;
    densityMin: number;
    densityMax: number;
    avPerDensityPerPc: number;
  };
  return {
    gridSize: manifest.gridSize,
    chunkSize: manifest.chunkSize,
    chunksPerAxis: manifest.chunksPerAxis,
    boundsHalfPc: manifest.boundsPc[1],
    voxelPc: manifest.voxelSizePc,
    densityMin: manifest.densityMin,
    densityMax: manifest.densityMax,
    avPerDensityPerPc: manifest.avPerDensityPerPc,
  };
}

export function makeDustField(params: DustParams, voxels: Uint8Array): DustField {
  const decode = new Float64Array(256);
  const ratio = params.densityMax / params.densityMin;
  for (let i = 0; i < 256; i++) decode[i] = params.densityMin * Math.pow(ratio, i / 255);
  return { params, voxels, decode };
}

export function loadDustField(root: string): DustField {
  const params = loadDustParams(root);
  const { gridSize: n, chunkSize: c, chunksPerAxis: nc } = params;
  const voxels = new Uint8Array(n * n * n);
  for (let ix = 0; ix < nc; ix++) {
    for (let iy = 0; iy < nc; iy++) {
      for (let iz = 0; iz < nc; iz++) {
        const buf = readFileSync(resolve(root, `data/dust/chunk_${ix}_${iy}_${iz}.bin`));
        for (let lz = 0; lz < c; lz++) {
          const gz = iz * c + lz;
          for (let ly = 0; ly < c; ly++) {
            const gy = iy * c + ly;
            const src = (lz * c + ly) * c;
            const dst = (gz * n + gy) * n + ix * c;
            for (let lx = 0; lx < c; lx++) voxels[dst + lx] = buf[src + lx];
          }
        }
      }
    }
  }
  return makeDustField(params, voxels);
}

/**
 * Trilinear density at a heliocentric ICRS point, in E_ZGR/pc. Filters the
 * DECODED values; the GPU filters the u8-log codes, which is a geometric
 * mean and under-reads a gradient — noted in the writeup, not mirrored.
 */
export function densityAt(field: DustField, x: number, y: number, z: number): number {
  const { gridSize: n, boundsHalfPc, voxelPc } = field.params;
  const cx = ((x + boundsHalfPc) / voxelPc) - 0.5;
  const cy = ((y + boundsHalfPc) / voxelPc) - 0.5;
  const cz = ((z + boundsHalfPc) / voxelPc) - 0.5;
  if (
    cx < -0.5 || cx > n - 0.5 ||
    cy < -0.5 || cy > n - 0.5 ||
    cz < -0.5 || cz > n - 0.5
  ) return 0;
  const x0 = Math.max(0, Math.min(n - 1, Math.floor(cx)));
  const y0 = Math.max(0, Math.min(n - 1, Math.floor(cy)));
  const z0 = Math.max(0, Math.min(n - 1, Math.floor(cz)));
  const x1 = Math.min(n - 1, x0 + 1);
  const y1 = Math.min(n - 1, y0 + 1);
  const z1 = Math.min(n - 1, z0 + 1);
  const fx = Math.max(0, Math.min(1, cx - x0));
  const fy = Math.max(0, Math.min(1, cy - y0));
  const fz = Math.max(0, Math.min(1, cz - z0));

  const { voxels, decode } = field;
  const r0 = (z0 * n + y0) * n;
  const r1 = (z0 * n + y1) * n;
  const r2 = (z1 * n + y0) * n;
  const r3 = (z1 * n + y1) * n;
  const d000 = decode[voxels[r0 + x0]];
  const d100 = decode[voxels[r0 + x1]];
  const d010 = decode[voxels[r1 + x0]];
  const d110 = decode[voxels[r1 + x1]];
  const d001 = decode[voxels[r2 + x0]];
  const d101 = decode[voxels[r2 + x1]];
  const d011 = decode[voxels[r3 + x0]];
  const d111 = decode[voxels[r3 + x1]];

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

export function analyticAvPerPc(rPc: number, zPc: number, avPerDensityPerPc: number): number {
  return (
    ANALYTICAL_DUST_NORM_PER_PC *
    Math.exp(-(rPc - R0_PC) / ANALYTICAL_DUST_SCALE_LENGTH_PC) *
    Math.exp(-Math.abs(zPc) / ANALYTICAL_DUST_SCALE_HEIGHT_PC) *
    avPerDensityPerPc
  );
}

/**
 * The cascade's A_V per pc at a galactocentric point: measured grid inside
 * the coverage sphere, analytic slab outside it, never both.
 */
export function cascadeAvPerPc(
  field: DustField,
  scratch: THREE.Vector3,
  gx: number,
  gy: number,
  gz: number,
): number {
  const p = galToIcrs(scratch, gx, gy, gz);
  const r = coverageRadiusPc(field.params);
  if (p.lengthSq() <= r * r) {
    return densityAt(field, p.x, p.y, p.z) * field.params.avPerDensityPerPc;
  }
  return analyticAvPerPc(Math.hypot(gx, gy), gz, field.params.avPerDensityPerPc);
}
