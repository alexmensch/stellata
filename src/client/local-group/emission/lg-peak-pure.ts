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

/** Jitter phases the central ray is scanned at, alongside the cusp phase
 *  (§ The brightest rendered pixel). The shader shifts every pixel's samples
 *  by a hash in [0, 1) of a step, so the nucleus pixel can land a sample
 *  anywhere in the step that straddles the centre. The scan is the safety net
 *  for structure away from the centre; `centralRayCuspPhase` is what actually
 *  finds the maximum, so this is 16 rather than the ~4000 a scan alone would
 *  need to match it. */
export const LG_PEAK_JITTER_PHASES = 16;

/** Camera travel the cached bound stays valid over. Surface brightness is
 *  distance-invariant; only the footprint softening moves, by the travel's
 *  share of the nearest object's distance. */
export const LG_PEAK_RECOMPUTE_PC = 500;

/** The march the shader runs along the camera→centre ray, resolved once so
 *  the phase scan and the cusp phase share it. */
interface CentralRay {
  readonly dir: Vec3;
  readonly worldPerT: number;
  readonly steps: number;
  readonly sStart: number;
  readonly logMin: number;
  readonly logStep: number;
  readonly zFootprintScale: number;
  /** Ray parameter, in pc along the ray, of the closest approach to the
   *  component centre — where a Sérsic profile puts all of its contrast. */
  readonly sClosest: number;
}

function centralRay(
  camLocal: Vec3,
  worldPerT: number,
  comp: EmissionComponent,
): CentralRay | null {
  const n = Math.hypot(camLocal[0], camLocal[1], camLocal[2]);
  const frag: Vec3 = [-camLocal[0] / n, -camLocal[1] / n, -camLocal[2] / n];
  const dir: Vec3 = [frag[0] - camLocal[0], frag[1] - camLocal[1], frag[2] - camLocal[2]];
  const tEnter = n > 1 ? (n - 1) / (n + 1) : 0;
  const sStart = Math.max(tEnter * worldPerT, EMISSION_S_MIN_PC);
  if (sStart >= worldPerT) return null;
  const steps = emissionStepsFor(comp);
  const logMin = Math.log(sStart);
  const dd = dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2];
  const tClosest = -(camLocal[0] * dir[0] + camLocal[1] * dir[1] + camLocal[2] * dir[2]) / dd;
  return {
    dir,
    worldPerT,
    steps,
    sStart,
    logMin,
    logStep: (Math.log(worldPerT) - logMin) / steps,
    zFootprintScale:
      comp.family === 'disc' ? footprintAlong(unitPhysDir(dir, comp.axesPc), [0, 0, 1]) : 0,
    sClosest: tClosest * worldPerT,
  };
}

/** The jitter phase that lands a march sample exactly on the closest
 *  approach. A scan cannot be relied on to find it: the cusp is narrower
 *  than any affordable phase spacing, and missing it understates the peak by
 *  up to 0.46 mag — in the direction that would authorise a skip. */
function centralRayCuspPhase(ray: CentralRay): number {
  if (!(ray.sClosest > 0)) return 0;
  const x = (Math.log(ray.sClosest) - ray.logMin) / ray.logStep;
  return x - Math.floor(x);
}

function columnAtPhase(
  camLocal: Vec3,
  ray: CentralRay,
  comp: EmissionComponent,
  omegaPxArcsec2: number,
  phase: number,
): number {
  let accum = 0;
  let prevS = ray.sStart;
  for (let i = 0; i < ray.steps; i++) {
    const sBoundary = Math.exp(ray.logMin + (i + 1) * ray.logStep);
    const sSample = Math.exp(ray.logMin + (i + phase) * ray.logStep);
    const dsPc = sBoundary - prevS;
    prevS = sBoundary;
    const t = sSample / ray.worldPerT;
    const p: [number, number, number] = [
      camLocal[0] + t * ray.dir[0],
      camLocal[1] + t * ray.dir[1],
      camLocal[2] + t * ray.dir[2],
    ];
    if (p[0] * p[0] + p[1] * p[1] + p[2] * p[2] > EMISSION_UNIT_BALL_SLACK) break;
    const footprintPc = footprintRadiusPc(sSample, omegaPxArcsec2);
    accum += cpuDensityAt(p, comp, footprintPc, footprintPc * ray.zFootprintScale) * dsPc;
  }
  return accum;
}

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
  const ray = centralRay(camLocal, worldPerT, comp);
  return ray === null ? 0 : columnAtPhase(camLocal, ray, comp, omegaPxArcsec2, phase);
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
 *  camera: the central ray's column maximised over the jitter phase — the
 *  cusp phase, which is where that maximum sits, plus a scan for anything
 *  the cusp argument does not cover. */
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

  const ray = centralRay(camLocal, worldPerT, comp);
  if (ray === null) return 0;
  let peak = columnAtPhase(camLocal, ray, comp, omegaPxArcsec2, centralRayCuspPhase(ray));
  for (let k = 0; k < phases; k++) {
    const column = columnAtPhase(camLocal, ray, comp, omegaPxArcsec2, k / phases);
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
