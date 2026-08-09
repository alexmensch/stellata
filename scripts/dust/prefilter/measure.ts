// The band march's error when its measured-dust read comes from a froxel grid
// instead of a direct march, after the 13' flat-disc summation the resolve
// convolves the band over. See README.md.

import * as THREE from 'three';
import { loadGrid } from './dust-grid';
import {
  directTotalAv,
  LocalFroxel,
  truthMeasuredAv,
  type FroxelConfig,
} from './froxel';
import {
  buildMarchPlan,
  planColumn,
  planMeasuredColumn,
  withAnalytic,
  type MarchPlan,
} from './march-plan';
import {
  SOL_GALACTOCENTRIC_PC,
  galacticDirection,
  type Vec3,
} from '../../../src/client/milkyway/milkyway-column-pure';

const ARCMIN = Math.PI / (180 * 60);
/** Ω_summation = 4.7863e5 arcsec² is a 13.0' critical DIAMETER. */
const PATCH_RADIUS_RAD = 6.5 * ARCMIN;
const PATCH_SAMPLES = 32;

interface PatchSample {
  readonly dir: THREE.Vector3;
  readonly plan: MarchPlan;
}

interface Sightline {
  readonly label: string;
  readonly centre: THREE.Vector3;
  readonly samples: PatchSample[];
  readonly truthColumn: number;
  readonly truthAv: number;
  readonly hitsCoverage: boolean;
}

function tangent(u: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const seed = Math.abs(u.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const e1 = new THREE.Vector3().crossVectors(seed, u).normalize();
  const e2 = new THREE.Vector3().crossVectors(u, e1).normalize();
  return [e1, e2];
}

function buildSightline(
  grid: Uint8Array,
  originPc: Vec3,
  lDeg: number,
  bDeg: number,
): Sightline {
  const d = galacticDirection(lDeg, bDeg);
  const centre = new THREE.Vector3(d[0], d[1], d[2]);
  const [e1, e2] = tangent(centre);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const samples: PatchSample[] = [];
  for (let m = 0; m < PATCH_SAMPLES; m++) {
    const r = PATCH_RADIUS_RAD * Math.sqrt((m + 0.5) / PATCH_SAMPLES);
    const th = m * golden;
    const dir = new THREE.Vector3()
      .copy(centre)
      .addScaledVector(e1, r * Math.cos(th))
      .addScaledVector(e2, r * Math.sin(th))
      .normalize();
    samples.push({
      plan: buildMarchPlan(originPc, [dir.x, dir.y, dir.z]),
      dir,
    });
  }
  let col = 0;
  let av = 0;
  let hits = false;
  for (const s of samples) {
    const measured = (sa: number, sb: number): number =>
      truthMeasuredAv(grid, s.plan.ray, s.plan.cov, sa, sb);
    col += planColumn(s.plan, withAnalytic(s.plan, measured)) / PATCH_SAMPLES;
    av += planMeasuredColumn(s.plan, measured) / PATCH_SAMPLES;
    hits ||= s.plan.cov.hit;
  }
  return {
    label: `l=${lDeg.toFixed(1)} b=${bDeg.toFixed(1)}`,
    centre,
    samples,
    truthColumn: col,
    truthAv: av,
    hitsCoverage: hits,
  };
}

interface Reading {
  readonly dSb: number;
  readonly dAv: number;
}

function readDirect(grid: Uint8Array, s: Sightline, sub: number): Reading {
  let col = 0;
  let av = 0;
  for (const p of s.samples) {
    col += planColumn(p.plan, (a, b) => directTotalAv(grid, p.plan.ray, a, b, sub)) / PATCH_SAMPLES;
    av +=
      planMeasuredColumn(p.plan, (a, b) =>
        p.plan.cov.hit
          ? directTotalAv(grid, p.plan.ray, Math.max(a, p.plan.cov.sIn), Math.min(b, p.plan.cov.sOut), sub)
          : 0,
      ) / PATCH_SAMPLES;
  }
  return { dSb: -2.5 * Math.log10(col / s.truthColumn), dAv: av - s.truthAv };
}

function readFroxel(
  grid: Uint8Array,
  s: Sightline,
  originPc: Vec3,
  cfg: FroxelConfig,
): Reading & { cells: number } {
  const origin = new THREE.Vector3(originPc[0], originPc[1], originPc[2]);
  const froxel = new LocalFroxel(grid, origin, s.centre, cfg);
  let col = 0;
  let av = 0;
  for (const p of s.samples) {
    const measured = (a: number, b: number): number => froxel.measuredAv(p.dir, a, b);
    col += planColumn(p.plan, withAnalytic(p.plan, measured)) / PATCH_SAMPLES;
    av += planMeasuredColumn(p.plan, measured) / PATCH_SAMPLES;
  }
  return {
    dSb: -2.5 * Math.log10(col / s.truthColumn),
    dAv: av - s.truthAv,
    cells: froxel.cellsBuilt,
  };
}

interface Stats {
  readonly max: number;
  readonly p99: number;
  readonly rms: number;
  readonly worst: string;
}

function stats(values: number[], labels: string[]): Stats {
  const abs = values.map(Math.abs);
  let max = 0;
  let worst = '';
  let sq = 0;
  for (let i = 0; i < abs.length; i++) {
    sq += abs[i] * abs[i];
    if (abs[i] > max) {
      max = abs[i];
      worst = labels[i];
    }
  }
  const sorted = [...abs].sort((a, b) => a - b);
  return {
    max,
    p99: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))],
    rms: Math.sqrt(sq / abs.length),
    worst,
  };
}

function line(name: string, sb: Stats, av: Stats): string {
  return (
    `  ${name.padEnd(30)} dSB max ${sb.max.toFixed(4)} p99 ${sb.p99.toFixed(4)} rms ${sb.rms.toFixed(4)}` +
    ` | dAV max ${av.max.toFixed(4)} p99 ${av.p99.toFixed(4)} | worst ${sb.worst}`
  );
}

const PHASES: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.5, 0.5],
  [0.5, 0],
  [0, 0.5],
];

/**
 * Worst-case angular error: the mag error at each strip sample divided by the
 * local gradient of the true profile, which is how far the feature moves. Only
 * where the profile actually has an edge to move.
 */
function edgeShiftArcmin(lines: Sightline[], dSb: number[], stepDeg: number): number {
  let worst = 0;
  for (let i = 1; i < lines.length - 1; i++) {
    const grad =
      Math.abs(-2.5 * Math.log10(lines[i + 1].truthColumn / lines[i - 1].truthColumn)) /
      (2 * stepDeg);
    if (grad < 0.05) continue;
    worst = Math.max(worst, (Math.abs(dSb[i]) / grad) * 60);
  }
  return worst;
}

function run(): void {
  const t0 = Date.now();
  const grid = loadGrid(process.cwd());
  console.log(`grid loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  const origin = SOL_GALACTOCENTRIC_PC;
  const sets: Array<{ name: string; lines: Sightline[]; originPc?: Vec3 }> = [];

  const STRIP_STEP_DEG = 0.25;
  const strip: Sightline[] = [];
  for (let b = -30; b <= 30.001; b += STRIP_STEP_DEG) {
    strip.push(buildSightline(grid, origin, 0, b));
  }
  sets.push({ name: `rift strip l=0, b=-30..30 @${STRIP_STEP_DEG}deg (${strip.length})`, lines: strip });

  const sky: Sightline[] = [];
  const n = 600;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const bDeg = (Math.asin(1 - (2 * (i + 0.5)) / n) * 180) / Math.PI;
    const lDeg = ((i * golden * 180) / Math.PI) % 360;
    sky.push(buildSightline(grid, origin, lDeg, bDeg));
  }
  sets.push({ name: `all-sky fibonacci (${sky.length})`, lines: sky });

  // Requirement 4: camera outside coverage, so the read needs an entry
  // distance as well as an exit. 3 kpc off-Sol toward the Galactic centre;
  // sightlines swept across the 24.6° half-angle the coverage sphere subtends.
  const offSolOrigin: Vec3 = [SOL_GALACTOCENTRIC_PC[0] + 3000, 0, 0];
  const offSol: Sightline[] = [];
  for (let b = -26; b <= 26.001; b += 0.25) offSol.push(buildSightline(grid, offSolOrigin, 180, b));
  sets.push({
    name: `3 kpc off-Sol, l=180 b=-26..26 (${offSol.length}, ${offSol.filter((s) => s.hitsCoverage).length} hit coverage)`,
    lines: offSol,
    originPc: offSolOrigin,
  });
  console.log(`sightlines built in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);

  for (const set of sets) {
    const setOrigin = set.originPc ?? origin;
    console.log(`## ${set.name}`);
    const labels = set.lines.map((s) => s.label);

    const isStrip = set === sets[0];
    const shift = (d: number[]): string =>
      isStrip ? ` | edge ${edgeShiftArcmin(set.lines, d, 0.25).toFixed(2)}'` : '';

    for (const sub of [1, 4, 16, 64]) {
      const r = set.lines.map((s) => readDirect(grid, s, sub));
      const d = r.map((x) => x.dSb);
      console.log(
        line(`direct march, ${sub}/step`, stats(d, labels), stats(r.map((x) => x.dAv), labels)) +
          shift(d),
      );
    }

    for (const cellArcmin of [13, 26]) {
      for (const slices of [24, 32, 64]) {
        for (const supersample of [1, 2]) {
          const perPhase = PHASES.map((phase) =>
            set.lines.map((s) =>
              readFroxel(grid, s, setOrigin, {
                cellRad: cellArcmin * ARCMIN,
                slices,
                phase,
                supersample,
              }),
            ),
          );
          const flatSb = perPhase.flat().map((x) => x.dSb);
          const flatAv = perPhase.flat().map((x) => x.dAv);
          const flatLabels = PHASES.flatMap(() => labels);
          const shimmer = set.lines.map((_, i) => {
            const vals = perPhase.map((p) => p[i].dSb);
            return Math.max(...vals) - Math.min(...vals);
          });
          const cells = perPhase[0].reduce((a, x) => a + x.cells, 0) / set.lines.length;
          console.log(
            line(
              `cell ${cellArcmin}' x${supersample} ${slices}sl`,
              stats(flatSb, flatLabels),
              stats(flatAv, flatLabels),
            ) +
              ` | shimmer ${stats(shimmer, labels).max.toFixed(4)}` +
              ` | rays/patch ${cells.toFixed(1)}` +
              shift(perPhase[1].map((x) => x.dSb)),
          );
        }
      }
    }
    console.log('');
  }
  console.log(`total ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

run();
