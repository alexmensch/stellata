// Texel counts and dust-fetch counts for the two froxel parameterisations —
// the cost currency that transfers to the GPU. See README.md.

import { coverageRadiusPc, loadDustParams, type DustParams } from './dust-grid';
import { allSkyCells, frustumSr, screenGridOverhead } from './cost-pure';
import { frustumCells } from '../../../src/client/dust/froxel/froxel-grid-pure';
import {
  ARCMIN_TO_RAD,
  PINNED_CELL_RAD,
  PINNED_FILL_STEPS_PER_VOXEL,
  PINNED_SLICES,
} from '../../../src/client/dust/froxel/froxel-pins';
import { DUST_STEPS } from '../../../src/client/star-pipeline/extinction/dust-raymarch-pure';
import {
  FOREGROUND_DUST_STEPS,
  S_MIN_PC,
  STEPS,
} from '../../../src/client/milkyway/milkyway-column-pure';

const BYTES_PER_TEXEL = 2;
const STAR_COUNT = 313_000;
const PREPASS_FETCHES = STAR_COUNT * DUST_STEPS;

const FOVS_DEG = [10, 50, 120];
const ASPECT = 16 / 9;

function mib(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function m(n: number): string {
  return `${(n / 1e6).toFixed(1)}M`;
}

function count(n: number): string {
  return n < 1e6 ? `${(n / 1e3).toFixed(1)}k` : m(n);
}

interface Grid {
  readonly name: string;
  readonly sr: number;
  /** Cells at a given coarsest-cell angle — the capped-resolution variant
   *  walks it per shell. */
  readonly cellsAt: (cellRad: number) => number;
}

const GRIDS: Grid[] = [
  { name: 'A: sky-fixed, all-sky', sr: 4 * Math.PI, cellsAt: allSkyCells },
  ...FOVS_DEG.map((fov) => ({
    name: `B: screen-space, ${fov}° FOV 16:9`,
    sr: frustumSr(fov, ASPECT),
    cellsAt: (rad: number) => frustumCells(fov, ASPECT, rad),
  })),
];

function row(grid: Grid, cells: string, texels: number, fill: number): string {
  return (
    `${grid.name.padEnd(34)} ${grid.sr.toFixed(2).padStart(6)} sr  ` +
    `cells ${cells.padStart(7)}  texels ${m(texels).padStart(7)}  ` +
    `${mib(texels * BYTES_PER_TEXEL).padStart(10)}  fill ${m(fill).padStart(8)} fetches` +
    `  = ${(fill / PREPASS_FETCHES).toFixed(1)}x the star prepass`
  );
}

function report(grid: Grid, fillSamplesPerRay: number): void {
  const cells = grid.cellsAt(PINNED_CELL_RAD);
  console.log(row(grid, count(cells), cells * PINNED_SLICES, cells * fillSamplesPerRay));
}

/**
 * The same structures with each shell's angular resolution capped at the
 * source's own at that distance — the grid carries no angular structure finer
 * than one voxel, so inner shells need fewer cells. Arithmetic only: the error
 * sweep measured a single resolution across all slices.
 */
function reportMipped(grid: Grid, params: DustParams, fillStepPc: number): void {
  const sMax = coverageRadiusPc(params);
  const ratio = Math.pow(sMax / S_MIN_PC, 1 / PINNED_SLICES);
  let texels = 0;
  let fill = 0;
  let prev = S_MIN_PC;
  for (let k = 1; k <= PINNED_SLICES; k++) {
    const d = S_MIN_PC * Math.pow(ratio, k);
    const cells = grid.cellsAt(Math.max(PINNED_CELL_RAD, params.voxelPc / d));
    texels += cells;
    fill += cells * ((d - prev) / fillStepPc);
    prev = d;
  }
  console.log(row(grid, '-', texels, fill));
}

function run(): void {
  const params = loadDustParams(process.cwd());
  const coverage = coverageRadiusPc(params);
  const fillStepPc = params.voxelPc / PINNED_FILL_STEPS_PER_VOXEL;
  /** Every sightline from Sol crosses the full radius. */
  const fillSamplesPerRay = Math.round(coverage / fillStepPc);

  console.log(
    `cell ${(PINNED_CELL_RAD / ARCMIN_TO_RAD).toFixed(2)}' · ${PINNED_SLICES} log slices · ` +
      `${BYTES_PER_TEXEL} B/texel · fill ${PINNED_FILL_STEPS_PER_VOXEL}/voxel = ` +
      `${fillStepPc.toFixed(2)} pc → ${fillSamplesPerRay} samples/ray from Sol`,
  );
  console.log(
    `voxel ${params.voxelPc.toFixed(3)} pc subtends ` +
      `${((params.voxelPc / coverage) / ARCMIN_TO_RAD).toFixed(2)}'` +
      ` at the ${coverage} pc coverage edge — the source's finest angular scale`,
  );
  console.log(
    'screen-uniform overhead over a uniform-in-angle count of the same coarsest cell: ' +
      FOVS_DEG.map((fov) => `${fov}° ${screenGridOverhead(fov, ASPECT).toFixed(2)}x`).join(' · ') +
      '\n',
  );
  console.log(
    `star prepass, for scale: ${STAR_COUNT / 1000}k stars x ${DUST_STEPS} steps = ` +
      `${m(PREPASS_FETCHES)} fetches per rebuild\n`,
  );

  for (const grid of GRIDS) report(grid, fillSamplesPerRay);

  console.log('\nsame, with per-shell resolution capped at the source\'s (arithmetic only):');
  for (const grid of GRIDS) reportMipped(grid, params, fillStepPc);

  console.log('\nper-frame READ (both candidates, and what it replaces):');
  for (const [label, px] of [
    ['1920x1080 @dpr1', 1920 * 1080],
    ['1920x1080 @dpr2', 3840 * 2160],
  ] as const) {
    const disc = px * STEPS;
    const bulge = px * (STEPS + FOREGROUND_DUST_STEPS);
    console.log(
      `  ${label}  disc ${m(disc)} + bulge ${m(bulge)} = ${m(disc + bulge)} fetches/frame ` +
        `(one per march step, replacing the same count of analytic evaluations)`,
    );
  }

  console.log('\nrotation: fraction of the cone newly exposed per frame at 50° FOV');
  for (const degPerFrame of [0.5, 1, 2]) {
    console.log(`  ${degPerFrame}°/frame → ${((degPerFrame / 50) * 100).toFixed(1)}% of the cone`);
  }
}

run();
