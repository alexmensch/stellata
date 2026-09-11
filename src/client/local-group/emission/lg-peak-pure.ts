// The Local Group glow's brightest rendered pixel from a camera position —
// the bound the brightness skip reads (docs/science-hdr-pipeline.md § 3.5).

import { footprintAlong, footprintRadiusPc } from '../../hdr/emission/emission-pure';
import type { LgEmission } from '../local-group-loader';
import {
  EMISSION_S_MIN_PC,
  EMISSION_UNIT_BALL_SLACK,
  columnSurfaceBrightness,
  cpuDensityAt,
  emissionComponents,
  emissionStepsFor,
  quatRotate,
  quatUnrotate,
  type EmissionComponent,
} from './local-group-emission-pure';

type Vec3 = readonly [number, number, number];
type Quat = readonly [number, number, number, number];

/** Jitter phases the central ray is marched at. The shader shifts every
 *  pixel's samples by a hash in [0, 1) of a step, so the nucleus pixel can
 *  land a sample anywhere in the step that straddles the centre — and on a
 *  Sérsic cusp that sample is the pixel. */
export const LG_PEAK_JITTER_PHASES = 64;

/** Camera travel the cached bound stays valid over. Surface brightness is
 *  distance-invariant; only the footprint softening moves, by the travel's
 *  share of the nearest object's distance. */
export const LG_PEAK_RECOMPUTE_PC = 500;

/**
 * The shader's own march along the ray from the camera through the
 * component's centre, at one jitter phase — `cpuRaymarchColumn` with the
 * sample position free inside the step. `camLocal` is in the unit-ball
 * frame, `worldPerT` the world length of the ray to its exit point.
 */
export function centralRayColumnAtPhase(
  camLocal: Vec3,
  worldPerT: number,
  comp: EmissionComponent,
  omegaPxArcsec2: number,
  phase: number,
): number {
  const n = Math.hypot(camLocal[0], camLocal[1], camLocal[2]);
  const frag: Vec3 = [-camLocal[0] / n, -camLocal[1] / n, -camLocal[2] / n];
  const dir: Vec3 = [frag[0] - camLocal[0], frag[1] - camLocal[1], frag[2] - camLocal[2]];
  const tEnter = n > 1 ? (n - 1) / (n + 1) : 0;
  const sStart = Math.max(tEnter * worldPerT, EMISSION_S_MIN_PC);
  const sEnd = worldPerT;
  if (sStart >= sEnd) return 0;
  const steps = emissionStepsFor(comp);
  const logMin = Math.log(sStart);
  const logStep = (Math.log(sEnd) - logMin) / steps;

  const zFootprintScale =
    comp.family === 'disc' ? footprintAlong(unitPhysDir(dir, comp.axesPc), [0, 0, 1]) : 0;

  let accum = 0;
  let prevS = sStart;
  for (let i = 0; i < steps; i++) {
    const sBoundary = Math.exp(logMin + (i + 1) * logStep);
    const sSample = Math.exp(logMin + (i + phase) * logStep);
    const dsPc = sBoundary - prevS;
    prevS = sBoundary;
    const t = sSample / worldPerT;
    const p: [number, number, number] = [
      camLocal[0] + t * dir[0],
      camLocal[1] + t * dir[1],
      camLocal[2] + t * dir[2],
    ];
    if (p[0] * p[0] + p[1] * p[1] + p[2] * p[2] > EMISSION_UNIT_BALL_SLACK) break;
    const footprintPc = footprintRadiusPc(sSample, omegaPxArcsec2);
    accum += cpuDensityAt(p, comp, footprintPc, footprintPc * zFootprintScale) * dsPc;
  }
  return accum;
}

function unitPhysDir(dirLocal: Vec3, axesPc: Vec3): [number, number, number] {
  const v: [number, number, number] = [
    dirLocal[0] * axesPc[0],
    dirLocal[1] * axesPc[1],
    dirLocal[2] * axesPc[2],
  ];
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** The brightest the component's central pixel can render from this
 *  camera: the central ray's column maximised over the jitter phase. */
export function componentPeakColumn(
  comp: EmissionComponent,
  cameraAbsPc: Vec3,
  centerAbsPc: Vec3,
  quat: Quat,
  omegaPxArcsec2: number,
  phases = LG_PEAK_JITTER_PHASES,
): number {
  const rel: Vec3 = [
    cameraAbsPc[0] - centerAbsPc[0],
    cameraAbsPc[1] - centerAbsPc[1],
    cameraAbsPc[2] - centerAbsPc[2],
  ];
  const oRaw = quatUnrotate(quat, rel);
  const camLocal: Vec3 = [
    oRaw[0] / comp.axesPc[0],
    oRaw[1] / comp.axesPc[1],
    oRaw[2] / comp.axesPc[2],
  ];
  const n = Math.hypot(camLocal[0], camLocal[1], camLocal[2]);
  const fragLocal: Vec3 = [-camLocal[0] / n, -camLocal[1] / n, -camLocal[2] / n];
  const fragWorld = quatRotate(quat, [
    fragLocal[0] * comp.axesPc[0],
    fragLocal[1] * comp.axesPc[1],
    fragLocal[2] * comp.axesPc[2],
  ]);
  const worldPerT = Math.hypot(fragWorld[0] - rel[0], fragWorld[1] - rel[1], fragWorld[2] - rel[2]);

  let peak = 0;
  for (let k = 0; k < phases; k++) {
    const column = centralRayColumnAtPhase(camLocal, worldPerT, comp, omegaPxArcsec2, k / phases);
    if (column > peak) peak = column;
  }
  return peak;
}

export interface LgPeakSource {
  readonly centerAbs: { readonly x: number; readonly y: number; readonly z: number };
  readonly quat: { readonly x: number; readonly y: number; readonly z: number; readonly w: number };
  readonly emission: LgEmission;
}

/** Brightest pixel one object can render, mag/arcsec²: its components'
 *  peak central columns summed, as the two additive passes composite
 *  them. The sub-pixel expansion is left out because it only lowers
 *  surface brightness. */
export function objectPeakSurfaceBrightness(
  source: LgPeakSource,
  cameraAbsPc: Vec3,
  omegaPxArcsec2: number,
): number {
  const c = source.centerAbs;
  const q = source.quat;
  const centre: Vec3 = [c.x, c.y, c.z];
  const quat: Quat = [q.x, q.y, q.z, q.w];
  let column = 0;
  for (const comp of emissionComponents(source.emission)) {
    column += componentPeakColumn(comp, cameraAbsPc, centre, quat, omegaPxArcsec2);
  }
  return columnSurfaceBrightness(column);
}

/** The layer's brightest pixel over every object; +Infinity for none. */
export function lgPeakSurfaceBrightness(
  objects: readonly LgPeakSource[],
  cameraAbsPc: Vec3,
  omegaPxArcsec2: number,
): number {
  let brightest = Number.POSITIVE_INFINITY;
  for (const o of objects) {
    const sb = objectPeakSurfaceBrightness(o, cameraAbsPc, omegaPxArcsec2);
    if (sb < brightest) brightest = sb;
  }
  return brightest;
}

/** Memo of the layer peak, keyed on camera pose and the pixel solid angle,
 *  never on exposure (hdr/exposure/README.md § One writer, five slots). */
export class LgPeakCache {
  private at: Vec3 | null = null;
  private omegaPxArcsec2 = Number.NaN;
  private peak = Number.NaN;

  peakAt(
    objects: readonly LgPeakSource[],
    cameraAbsPc: Vec3,
    omegaPxArcsec2: number,
  ): number {
    if (this.at !== null && omegaPxArcsec2 === this.omegaPxArcsec2) {
      const dx = cameraAbsPc[0] - this.at[0];
      const dy = cameraAbsPc[1] - this.at[1];
      const dz = cameraAbsPc[2] - this.at[2];
      if (Math.hypot(dx, dy, dz) <= LG_PEAK_RECOMPUTE_PC) return this.peak;
    }
    this.at = [cameraAbsPc[0], cameraAbsPc[1], cameraAbsPc[2]];
    this.omegaPxArcsec2 = omegaPxArcsec2;
    this.peak = lgPeakSurfaceBrightness(objects, cameraAbsPc, omegaPxArcsec2);
    return this.peak;
  }

  /** Dispose must call this: the null sentinel is what fails the first read. */
  reset(): void {
    this.at = null;
    this.omegaPxArcsec2 = Number.NaN;
    this.peak = Number.NaN;
  }
}
