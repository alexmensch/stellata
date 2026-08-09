// Texel counts and dust-fetch counts for the two froxel parameterisations —
// the cost currency that transfers to the GPU. See README.md.

import { COVERAGE_RADIUS_PC, VOXEL_PC } from './dust-grid';

const ARCMIN = Math.PI / (180 * 60);
const CELL_ARCMIN = 13.0;
const CELL_RAD = CELL_ARCMIN * ARCMIN;
const SLICES = 32;
const BYTES_PER_TEXEL = 2;
/** Fill sampling: half a voxel along the ray. */
const FILL_STEP_PC = VOXEL_PC / 2;
/** Every sightline from Sol crosses the full radius. */
const CHORD_FROM_SOL_PC = COVERAGE_RADIUS_PC;
const FILL_SAMPLES_PER_RAY = Math.round(CHORD_FROM_SOL_PC / FILL_STEP_PC);

const STAR_COUNT = 313_000;
const PREPASS_STEPS = 48;
const PREPASS_FETCHES = STAR_COUNT * PREPASS_STEPS;

/** Solid angle of a rectangular frustum, steradians. */
function frustumSr(fovVDeg: number, aspect: number): number {
  const h = (fovVDeg * Math.PI) / 180;
  const w = 2 * Math.atan(Math.tan(h / 2) * aspect);
  return 4 * Math.asin(Math.sin(w / 2) * Math.sin(h / 2));
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function m(n: number): string {
  return `${(n / 1e6).toFixed(1)}M`;
}

function report(name: string, sr: number): void {
  const cells = sr / (CELL_RAD * CELL_RAD);
  const texels = cells * SLICES;
  const fill = cells * FILL_SAMPLES_PER_RAY;
  console.log(
    `${name.padEnd(34)} ${sr.toFixed(2).padStart(6)} sr  ` +
      `cells ${m(cells).padStart(7)}  texels ${m(texels).padStart(7)}  ` +
      `${mb(texels * BYTES_PER_TEXEL).padStart(9)}  fill ${m(fill).padStart(8)} fetches` +
      `  = ${(fill / PREPASS_FETCHES).toFixed(1)}x the star prepass`,
  );
}

console.log(
  `cell ${CELL_ARCMIN}' · ${SLICES} log slices · ${BYTES_PER_TEXEL} B/texel · ` +
    `fill step ${FILL_STEP_PC.toFixed(2)} pc → ${FILL_SAMPLES_PER_RAY} samples/ray from Sol`,
);
console.log(
  `voxel ${VOXEL_PC.toFixed(3)} pc subtends ${((VOXEL_PC / COVERAGE_RADIUS_PC) / ARCMIN).toFixed(2)}'` +
    ` at the ${COVERAGE_RADIUS_PC} pc coverage edge — the source's finest angular scale\n`,
);
console.log(`star prepass, for scale: ${m(PREPASS_FETCHES)} fetches per rebuild\n`);

report('A: sky-fixed, all-sky', 4 * Math.PI);
for (const fov of [10, 50, 120]) {
  report(`B: screen-space, ${fov}° FOV 16:9`, frustumSr(fov, 16 / 9));
}

/**
 * The same structures with each shell's angular resolution capped at the
 * source's own at that distance — the grid carries no angular structure finer
 * than one voxel, so inner shells need fewer cells. Arithmetic only: the error
 * sweep measured a single resolution across all slices.
 */
function reportMipped(name: string, sr: number): void {
  const sMin = 1;
  const sMax = COVERAGE_RADIUS_PC;
  const ratio = Math.pow(sMax / sMin, 1 / SLICES);
  let texels = 0;
  let fill = 0;
  let prev = sMin;
  for (let k = 1; k <= SLICES; k++) {
    const d = sMin * Math.pow(ratio, k);
    const cells = sr / Math.max(CELL_RAD, VOXEL_PC / d) ** 2;
    texels += cells;
    fill += cells * ((d - prev) / FILL_STEP_PC);
    prev = d;
  }
  console.log(
    `${name.padEnd(34)} ${sr.toFixed(2).padStart(6)} sr  ` +
      `${'-'.padStart(13)}  texels ${m(texels).padStart(7)}  ` +
      `${mb(texels * BYTES_PER_TEXEL).padStart(9)}  fill ${m(fill).padStart(8)} fetches` +
      `  = ${(fill / PREPASS_FETCHES).toFixed(1)}x the star prepass`,
  );
}

console.log('\nsame, with per-shell resolution capped at the source\'s (arithmetic only):');
reportMipped('A: sky-fixed, all-sky', 4 * Math.PI);
for (const fov of [10, 50, 120]) {
  reportMipped(`B: screen-space, ${fov}° FOV 16:9`, frustumSr(fov, 16 / 9));
}

console.log('\nper-frame READ (both candidates, and what it replaces):');
for (const [label, px] of [
  ['1920x1080 @dpr1', 1920 * 1080],
  ['1920x1080 @dpr2', 3840 * 2160],
] as const) {
  const disc = px * 32;
  const bulge = px * (32 + 16);
  console.log(
    `  ${label}  disc ${m(disc)} + bulge ${m(bulge)} = ${m(disc + bulge)} fetches/frame ` +
      `(one per march step, replacing the same count of analytic evaluations)`,
  );
}

console.log('\nrotation: fraction of the cone newly exposed per frame at 50° FOV');
for (const degPerFrame of [0.5, 1, 2]) {
  console.log(`  ${degPerFrame}°/frame → ${((degPerFrame / 50) * 100).toFixed(1)}% of the cone`);
}
