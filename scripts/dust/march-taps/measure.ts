// Entry point of the tap sweep — README.md § What it measures.

import { resolve } from 'node:path';

import { loadCatalog } from '../../catalog/catalog-lookup';
import { loadDustGrid } from '../../catalog/distance/dust/dust-deextinction';
import {
  avAlongSegment, sampleEncodedAt, type DustGrid,
} from '../../catalog/distance/dust/dust-deextinction-pure';
import { REPO_ROOT } from '../../util/paths';
import { GALACTIC_NORTH_POLE_ICRS } from '../../../src/client/galactic/galactic-coords';
import {
  DUST_TAPS_MAX,
  DUST_TAP_PC,
  dustMarchTapCount,
  dustRaymarchAv,
  segmentCubeOverlap,
  type DustDecodeParams,
  type TapCountRule,
  type Vec3,
} from '../../../src/client/star-pipeline/extinction/dust-raymarch-pure';
import {
  FIXED_MARCH_TAPS, fp32March, strideSample, summarise, unclippedFixedMarch,
} from './march-taps-pure';

const DEFAULT_STARS = 20_000;
const FIXED_TAPS = [FIXED_MARCH_TAPS, 32, 24, 16];
const TAP_DENSITIES_PC = [5, 10, 15, 20, 30];
const TAP_CAPS = [FIXED_MARCH_TAPS, DUST_TAPS_MAX];

interface Scheme {
  name: string;
  av: (from: Vec3, to: Vec3) => number;
  /** Taps the GPU loop runs for this segment. */
  taps: (inCubeLenPc: number | null) => number;
}

function schemes(sample: (u: number, v: number, w: number) => number, p: DustDecodeParams): Scheme[] {
  const clipped = (rule: TapCountRule) => (from: Vec3, to: Vec3) =>
    dustRaymarchAv(from, to, sample, p, rule);
  const capped = (d: number, cap: number): TapCountRule => (len) =>
    dustMarchTapCount(len, d, cap);
  return [
    {
      name: `unclipped fixed ${FIXED_MARCH_TAPS}`,
      av: (from, to) => unclippedFixedMarch(from, to, sample, p, FIXED_MARCH_TAPS),
      taps: () => FIXED_MARCH_TAPS,
    },
    ...FIXED_TAPS.map((n): Scheme => ({
      name: `clipped fixed ${n}`,
      av: clipped(() => n),
      taps: (len) => (len === null ? 0 : n),
    })),
    ...TAP_CAPS.flatMap((cap) => TAP_DENSITIES_PC.map((d): Scheme => {
      const rule = capped(d, cap);
      const shipped = d === DUST_TAP_PC && cap === DUST_TAPS_MAX ? ' (shipped)' : '';
      return {
        name: `${d} pc/tap cap ${cap}${shipped}`,
        av: clipped(rule),
        taps: (len) => (len === null ? 0 : rule(len)),
      };
    })),
    {
      name: `${DUST_TAP_PC} pc/tap cap ${DUST_TAPS_MAX}, fp32`,
      av: (from, to) => fp32March(from, to, sample, p),
      taps: (len) => (len === null ? 0 : dustMarchTapCount(len)),
    },
  ];
}

function scaled(dir: { x: number; y: number; z: number }, pc: number): Vec3 {
  return [dir.x * pc, dir.y * pc, dir.z * pc];
}

const VANTAGES: Array<{ name: string; pos: Vec3 }> = [
  { name: 'sol', pos: [0, 0, 0] },
  { name: '500 pc above the plane', pos: scaled(GALACTIC_NORTH_POLE_ICRS, 500) },
  { name: '3 kpc above the plane', pos: scaled(GALACTIC_NORTH_POLE_ICRS, 3000) },
  { name: '1 Mpc above the plane', pos: scaled(GALACTIC_NORTH_POLE_ICRS, 1e6) },
];

function paramsOf(grid: DustGrid): DustDecodeParams {
  return {
    boundsPc: grid.boundsHalfPc,
    densityMin: grid.densityMin,
    logRatio: grid.logRatio,
    avPerDensityPc: grid.avPerDensityPc,
  };
}

function inCubeLength(from: Vec3, to: Vec3, boundsPc: number): number | null {
  const delta: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const [t0, t1] = segmentCubeOverlap(from, delta, boundsPc);
  return t1 <= t0 ? null : (t1 - t0) * Math.hypot(...delta);
}

function argInt(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

async function run(): Promise<void> {
  const grid = loadDustGrid(resolve(REPO_ROOT, 'data/dust'));
  const p = paramsOf(grid);
  const sample = (u: number, v: number, w: number) => sampleEncodedAt(grid, u, v, w);
  const catalog = await loadCatalog();
  const stars = strideSample(catalog.count, argInt('--stars', DEFAULT_STARS))
    .map((i) => catalog.record(i))
    .map((r): Vec3 => [r.x, r.y, r.z]);
  const table = schemes(sample, p);

  console.log(
    `${stars.length} of ${catalog.count} records · reference = midpoint rule at ≤ ` +
      `${grid.voxelSizePc.toFixed(2)} pc over the in-cube overlap · errors in mag of A_V\n`,
  );
  for (const { name, pos } of VANTAGES) {
    const refs = stars.map((s) => avAlongSegment(grid, pos, s));
    const lens = stars.map((s) => inCubeLength(pos, s, p.boundsPc));
    const inCube = lens.filter((l) => l !== null).length;
    console.log(
      `camera: ${name} — ${((inCube / stars.length) * 100).toFixed(1)}% of sightlines cross the cube`,
    );
    console.log(
      `  ${'scheme'.padEnd(26)} ${'mean taps'.padStart(9)} ${'p50'.padStart(8)} ` +
        `${'p90'.padStart(8)} ${'p99'.padStart(8)} ${'max'.padStart(8)}`,
    );
    for (const scheme of table) {
      const errors: number[] = [];
      let taps = 0;
      stars.forEach((s, i) => {
        errors.push(Math.abs(scheme.av(pos, s) - refs[i]));
        taps += scheme.taps(lens[i]);
      });
      const e = summarise(errors);
      console.log(
        `  ${scheme.name.padEnd(26)} ${(taps / stars.length).toFixed(1).padStart(9)} ` +
          `${e.p50.toFixed(4).padStart(8)} ${e.p90.toFixed(4).padStart(8)} ` +
          `${e.p99.toFixed(4).padStart(8)} ${e.max.toFixed(4).padStart(8)}`,
      );
    }
    console.log();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
