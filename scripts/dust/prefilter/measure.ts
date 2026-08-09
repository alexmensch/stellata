// The band march's error when its measured-dust read comes from a froxel grid
// instead of a direct march, after the 13' flat-disc summation the resolve
// convolves the band over. See README.md.

import * as THREE from 'three';
import { loadDustField, type DustField } from './dust-grid';
import {
  directTotalAv,
  LocalFroxel,
  tangentBasis,
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
  ARCMIN_TO_RAD,
  PATCH_RADIUS_RAD,
  PINNED_CELL_RAD,
  PINNED_FILL_STEPS_PER_VOXEL,
  PINNED_SLICES,
} from './prefilter-pins';
import {
  SOL_GALACTOCENTRIC_PC,
  galacticDirection,
  type Vec3,
} from '../../../src/client/milkyway/milkyway-column-pure';

const PATCH_SAMPLES = 32;
const STRIP_STEP_DEG = 0.25;
/** The measured column is reported for the disc, whose march spans the whole
 *  sightline; the bulge's covers its own proxy only. */
const COLUMN_COMPONENT = 'disc';

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

function buildSightline(
  field: DustField,
  originPc: Vec3,
  lDeg: number,
  bDeg: number,
): Sightline {
  const d = galacticDirection(lDeg, bDeg);
  const centre = new THREE.Vector3(d[0], d[1], d[2]);
  const [e1, e2] = tangentBasis(centre);
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
      plan: buildMarchPlan(field, originPc, [dir.x, dir.y, dir.z]),
      dir,
    });
  }
  let col = 0;
  let av = 0;
  let hits = false;
  for (const s of samples) {
    const measured = (sa: number, sb: number): number =>
      truthMeasuredAv(field, s.plan.ray, s.plan.cov, sa, sb);
    col += planColumn(s.plan, withAnalytic(measured)) / PATCH_SAMPLES;
    av += planMeasuredColumn(s.plan, COLUMN_COMPONENT, measured) / PATCH_SAMPLES;
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

function readDirect(field: DustField, s: Sightline, sub: number): Reading {
  let col = 0;
  let av = 0;
  for (const p of s.samples) {
    col += planColumn(p.plan, (step) => directTotalAv(field, p.plan.ray, step.sa, step.sb, sub)) /
      PATCH_SAMPLES;
    av +=
      planMeasuredColumn(p.plan, COLUMN_COMPONENT, (a, b) =>
        p.plan.cov.hit
          ? directTotalAv(
              field,
              p.plan.ray,
              Math.max(a, p.plan.cov.sIn),
              Math.min(b, p.plan.cov.sOut),
              sub,
            )
          : 0,
      ) / PATCH_SAMPLES;
  }
  return { dSb: -2.5 * Math.log10(col / s.truthColumn), dAv: av - s.truthAv };
}

function readFroxel(
  field: DustField,
  s: Sightline,
  originPc: Vec3,
  cfg: FroxelConfig,
): Reading & { cells: number } {
  const origin = new THREE.Vector3(originPc[0], originPc[1], originPc[2]);
  const froxel = new LocalFroxel(field, origin, s.centre, cfg);
  let col = 0;
  let av = 0;
  for (const p of s.samples) {
    const measured = (a: number, b: number): number => froxel.measuredAv(p.dir, a, b);
    col += planColumn(p.plan, withAnalytic(measured)) / PATCH_SAMPLES;
    av += planMeasuredColumn(p.plan, COLUMN_COMPONENT, measured) / PATCH_SAMPLES;
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
    `  ${name.padEnd(34)} dSB max ${sb.max.toFixed(4)} p99 ${sb.p99.toFixed(4)} rms ${sb.rms.toFixed(4)}` +
    ` | dAV max ${av.max.toFixed(4)} p99 ${av.p99.toFixed(4)} | worst ${sb.worst}`
  );
}

/** Grid poses a screen-space grid passes through as the camera turns: the
 *  sub-cell offset AND the roll of the cell axes. A sky-fixed grid holds one,
 *  so the spread across them is the frustum grid's shimmer alone. */
const POSES: ReadonlyArray<{ phase: readonly [number, number]; rollRad: number }> = [
  { phase: [0, 0], rollRad: 0 },
  { phase: [0.5, 0.5], rollRad: 0 },
  { phase: [0.5, 0], rollRad: (22.5 * Math.PI) / 180 },
  { phase: [0, 0.5], rollRad: (45 * Math.PI) / 180 },
  { phase: [0.25, 0.75], rollRad: (67.5 * Math.PI) / 180 },
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

interface SightlineSet {
  readonly name: string;
  readonly lines: Sightline[];
  readonly originPc: Vec3;
  /** Set for a strip dense enough to differentiate, which is what turns a mag
   *  error into the angular shift the requirement is stated in. */
  readonly stripStepDeg?: number;
}

function run(): void {
  const t0 = Date.now();
  const field = loadDustField(process.cwd());
  console.log(`grid loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  const origin = SOL_GALACTOCENTRIC_PC;
  const sets: SightlineSet[] = [];

  const strip: Sightline[] = [];
  for (let b = -30; b <= 30.001; b += STRIP_STEP_DEG) {
    strip.push(buildSightline(field, origin, 0, b));
  }
  sets.push({
    name: `rift strip l=0, b=-30..30 @${STRIP_STEP_DEG}deg (${strip.length})`,
    lines: strip,
    originPc: origin,
    stripStepDeg: STRIP_STEP_DEG,
  });

  const sky: Sightline[] = [];
  const n = 600;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const bDeg = (Math.asin(1 - (2 * (i + 0.5)) / n) * 180) / Math.PI;
    const lDeg = ((i * golden * 180) / Math.PI) % 360;
    sky.push(buildSightline(field, origin, lDeg, bDeg));
  }
  sets.push({ name: `all-sky fibonacci (${sky.length})`, lines: sky, originPc: origin });

  // Requirement 4: camera outside coverage, so the read needs an entry
  // distance as well as an exit. 3 kpc off-Sol toward the Galactic centre;
  // sightlines swept across the 24.6° half-angle the coverage sphere subtends.
  const offSolOrigin: Vec3 = [SOL_GALACTOCENTRIC_PC[0] + 3000, 0, 0];
  const offSol: Sightline[] = [];
  for (let b = -26; b <= 26.001; b += STRIP_STEP_DEG) {
    offSol.push(buildSightline(field, offSolOrigin, 180, b));
  }
  sets.push({
    name: `3 kpc off-Sol, l=180 b=-26..26 (${offSol.length}, ${offSol.filter((s) => s.hitsCoverage).length} hit coverage)`,
    lines: offSol,
    originPc: offSolOrigin,
  });
  console.log(`sightlines built in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);

  const pinnedCellArcmin = PINNED_CELL_RAD / ARCMIN_TO_RAD;
  const cellAngles = [PINNED_CELL_RAD, 2 * PINNED_CELL_RAD];
  const sliceCounts = [24, PINNED_SLICES, 64];
  const supersamples = [1, 2];
  const fillRates = [1, PINNED_FILL_STEPS_PER_VOXEL, 4];

  for (const set of sets) {
    console.log(`## ${set.name}`);
    const labels = set.lines.map((s) => s.label);
    const shift = (perPose: number[][]): string =>
      set.stripStepDeg === undefined
        ? ''
        : ` | edge ${Math.max(
            ...perPose.map((d) => edgeShiftArcmin(set.lines, d, set.stripStepDeg as number)),
          ).toFixed(2)}'`;

    for (const sub of [1, 4, 16, 64]) {
      const r = set.lines.map((s) => readDirect(field, s, sub));
      const d = r.map((x) => x.dSb);
      console.log(
        line(`direct march, ${sub}/step`, stats(d, labels), stats(r.map((x) => x.dAv), labels)) +
          shift([d]),
      );
    }

    const configs: FroxelConfig[] = [];
    for (const cellRad of cellAngles) {
      for (const slices of sliceCounts) {
        for (const supersample of supersamples) {
          configs.push({
            cellRad,
            slices,
            phase: [0, 0],
            rollRad: 0,
            supersample,
            fillStepsPerVoxel: PINNED_FILL_STEPS_PER_VOXEL,
          });
        }
      }
    }
    for (const fillStepsPerVoxel of fillRates) {
      if (fillStepsPerVoxel === PINNED_FILL_STEPS_PER_VOXEL) continue;
      configs.push({
        cellRad: PINNED_CELL_RAD,
        slices: PINNED_SLICES,
        phase: [0, 0],
        rollRad: 0,
        supersample: 1,
        fillStepsPerVoxel,
      });
    }

    for (const cfg of configs) {
      const perPose = POSES.map((pose) =>
        set.lines.map((s) => readFroxel(field, s, set.originPc, { ...cfg, ...pose })),
      );
      const flatSb = perPose.flat().map((x) => x.dSb);
      const flatAv = perPose.flat().map((x) => x.dAv);
      const flatLabels = POSES.flatMap(() => labels);
      const shimmer = set.lines.map((_, i) => {
        const vals = perPose.map((p) => p[i].dSb);
        return Math.max(...vals) - Math.min(...vals);
      });
      const cells = perPose[0].reduce((a, x) => a + x.cells, 0) / set.lines.length;
      const cellArcmin = cfg.cellRad / ARCMIN_TO_RAD;
      const fill =
        cfg.fillStepsPerVoxel === PINNED_FILL_STEPS_PER_VOXEL
          ? ''
          : ` fill${cfg.fillStepsPerVoxel}/vox`;
      console.log(
        line(
          `cell ${cellArcmin.toFixed(1)}' x${cfg.supersample} ${cfg.slices}sl${fill}`,
          stats(flatSb, flatLabels),
          stats(flatAv, flatLabels),
        ) +
          ` | shimmer ${stats(shimmer, labels).max.toFixed(4)}` +
          ` | rays/patch ${cells.toFixed(1)}` +
          shift(perPose.map((p) => p.map((x) => x.dSb))),
      );
    }
    console.log('');
  }
  console.log(
    `pinned cell ${pinnedCellArcmin.toFixed(2)}' (patch diameter), ${PINNED_SLICES} slices, ` +
      `fill ${PINNED_FILL_STEPS_PER_VOXEL}/voxel · total ${((Date.now() - t0) / 1000).toFixed(1)} s`,
  );
}

run();
