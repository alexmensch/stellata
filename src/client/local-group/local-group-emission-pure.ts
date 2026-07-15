// Pure side of the LG emission renderer: instance-buffer packing, the
// CPU mirror of the GLSL raymarch, and the flux ↔ magnitude inverse.
// Keep the mirror in lockstep with local-group-emission.frag.glsl.

import type { LgEmission, LgObject, SersicParams } from './local-group-loader';

/** Population tints, seeded from the Milky Way palette (warm
 *  near-white bulge tone for old spheroid populations, pale lavender
 *  for discs). Per-object `emission.color` overrides. */
export const SPHEROID_COLOR_RGB: [number, number, number] = [1.0, 0.9647, 0.9294];
export const DISC_COLOR_RGB: [number, number, number] = [0.6706, 0.6588, 0.8745];

/** Raymarch scheme shared by the GLSL shader and the CPU mirror. */
export const EMISSION_STEPS = 32;
export const EMISSION_S_MIN_PC = 0.1;
/** Ellipsoidal-radius floor guarding the u^(−pn) central singularity. */
export const EMISSION_U_FLOOR = 1e-4;

export interface EmissionInstanceCommon {
  count: number;
  /** vec3 per instance — absolute ICRS centre, pc. */
  centerAbs: Float32Array;
  /** vec4 per instance — local→ICRS quaternion. */
  quat: Float32Array;
  /** vec3 per instance — proxy-mesh half-extents, pc. */
  axes: Float32Array;
  /** vec3 per instance — population tint. */
  color: Float32Array;
  /** Source object index per instance (test / debug read-back). */
  objectIndex: number[];
}

export interface SersicInstanceData extends EmissionInstanceCommon {
  /** vec4 per instance — (density0, 1/n, bn, pn). */
  sersic: Float32Array;
  /** float per instance — mesh radius in units of R_e. */
  uMax: Float32Array;
}

export interface DiscInstanceData extends EmissionInstanceCommon {
  /** vec3 per instance — (density0, 1/R_d, 1/z_d). */
  disc: Float32Array;
  /** vec4 per instance — bulge (density0, 1/n, bn, pn); density0 = 0 → none. */
  bulge: Float32Array;
  /** vec2 per instance — bulge (1/R_e, uMax). */
  bulgeExt: Float32Array;
}

/** Proxy-mesh half-extents for an emission block — uMax × R_e for
 *  spheroids, the (rEnv, rEnv, zEnv) envelope for discs. */
export function emissionMeshAxes(e: LgEmission): [number, number, number] {
  if (e.family === 'disc') return [e.rEnvPc, e.rEnvPc, e.zEnvPc];
  return [e.uMax * e.reffAxesPc[0], e.uMax * e.reffAxesPc[1], e.uMax * e.reffAxesPc[2]];
}

/** Rotate v by quaternion q = [x, y, z, w] — the shader's quatRotate. */
export function quatRotate(
  q: readonly [number, number, number, number],
  v: readonly [number, number, number],
): [number, number, number] {
  const [qx, qy, qz, qw] = q;
  const cx = qy * v[2] - qz * v[1] + qw * v[0];
  const cy = qz * v[0] - qx * v[2] + qw * v[1];
  const cz = qx * v[1] - qy * v[0] + qw * v[2];
  return [
    v[0] + 2 * (qy * cz - qz * cy),
    v[1] + 2 * (qz * cx - qx * cz),
    v[2] + 2 * (qx * cy - qy * cx),
  ];
}

/** Rotate v by the conjugate of q — world → instance-local. */
export function quatUnrotate(
  q: readonly [number, number, number, number],
  v: readonly [number, number, number],
): [number, number, number] {
  return quatRotate([-q[0], -q[1], -q[2], q[3]], v);
}

function parseHexColor(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
}

function tintFor(e: LgEmission): [number, number, number] {
  const override = e.color ? parseHexColor(e.color) : null;
  if (override) return override;
  return e.family === 'disc' ? DISC_COLOR_RGB : SPHEROID_COLOR_RGB;
}

/** Split the catalog by emission family and pack the per-instance
 *  attribute arrays both GPU passes consume. Pure — testable without a
 *  GL context. */
export function buildEmissionInstanceData(objects: readonly LgObject[]): {
  sersic: SersicInstanceData;
  disc: DiscInstanceData;
} {
  const sersicIdx: number[] = [];
  const discIdx: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    (objects[i].emission.family === 'disc' ? discIdx : sersicIdx).push(i);
  }

  const packCommon = (idxs: number[]): EmissionInstanceCommon => {
    const n = idxs.length;
    const common: EmissionInstanceCommon = {
      count: n,
      centerAbs: new Float32Array(n * 3),
      quat: new Float32Array(n * 4),
      axes: new Float32Array(n * 3),
      color: new Float32Array(n * 3),
      objectIndex: idxs.slice(),
    };
    for (let k = 0; k < n; k++) {
      const o = objects[idxs[k]];
      common.centerAbs.set([o.centerAbs.x, o.centerAbs.y, o.centerAbs.z], k * 3);
      common.quat.set([o.quat.x, o.quat.y, o.quat.z, o.quat.w], k * 4);
      common.color.set(tintFor(o.emission), k * 3);
      common.axes.set(emissionMeshAxes(o.emission), k * 3);
    }
    return common;
  };

  const sersic: SersicInstanceData = {
    ...packCommon(sersicIdx),
    sersic: new Float32Array(sersicIdx.length * 4),
    uMax: new Float32Array(sersicIdx.length),
  };
  for (let k = 0; k < sersicIdx.length; k++) {
    const e = objects[sersicIdx[k]].emission;
    if (e.family !== 'sersic') continue;
    sersic.sersic.set([e.density0, 1 / e.n, e.bn, e.pn], k * 4);
    sersic.uMax[k] = e.uMax;
  }

  const disc: DiscInstanceData = {
    ...packCommon(discIdx),
    disc: new Float32Array(discIdx.length * 3),
    bulge: new Float32Array(discIdx.length * 4),
    bulgeExt: new Float32Array(discIdx.length * 2),
  };
  for (let k = 0; k < discIdx.length; k++) {
    const e = objects[discIdx[k]].emission;
    if (e.family !== 'disc') continue;
    disc.disc.set([e.density0, 1 / e.rdPc, 1 / e.zdPc], k * 3);
    const b: SersicParams | undefined = e.bulge;
    if (b) {
      disc.bulge.set([b.density0, 1 / b.n, b.bn, b.pn], k * 4);
      disc.bulgeExt.set([1 / b.reffAxesPc[0], b.uMax], k * 2);
    }
  }

  return { sersic, disc };
}

/** Deprojected Sérsic density with the same U_FLOOR clamp the shader
 *  applies. */
export function cpuSersicNu(u: number, invN: number, bn: number, pn: number): number {
  const uc = Math.max(u, EMISSION_U_FLOOR);
  return Math.pow(uc, -pn) * Math.exp(-bn * Math.pow(uc, invN));
}

/** Density at a unit-ball point for one emission block — the CPU twin
 *  of the shader's densityAt. pLocal is in the proxy mesh's unit-ball
 *  frame. */
export function cpuDensityAt(
  pLocal: [number, number, number],
  e: LgEmission,
): number {
  if (e.family === 'disc') {
    const x = pLocal[0] * e.rEnvPc;
    const y = pLocal[1] * e.rEnvPc;
    const z = pLocal[2] * e.zEnvPc;
    const R = Math.hypot(x, y);
    let rho = e.density0 * Math.exp(-R / e.rdPc - Math.abs(z) / e.zdPc);
    if (e.bulge) {
      const u = Math.hypot(x, y, z) / e.bulge.reffAxesPc[0];
      if (u <= e.bulge.uMax) {
        rho += e.bulge.density0 * cpuSersicNu(u, 1 / e.bulge.n, e.bulge.bn, e.bulge.pn);
      }
    }
    return rho;
  }
  const u = Math.hypot(pLocal[0], pLocal[1], pLocal[2]) * e.uMax;
  return e.density0 * cpuSersicNu(u, 1 / e.n, e.bn, e.pn);
}

/** CPU mirror of the fragment shader's bounded raymarch: unit-sphere
 *  entry/exit from `camLocal` toward the back-face point `fragLocal`
 *  (on the unit sphere), EMISSION_STEPS log-distributed samples,
 *  Σ ρ·ds in F·pc column units. Returns 0 when the ray misses.
 *  `worldPerT` is the world-pc length of one t-unit
 *  (|fragWorld − cameraWorld|). */
export function cpuRaymarchColumn(
  camLocal: [number, number, number],
  fragLocal: [number, number, number],
  worldPerT: number,
  e: LgEmission,
  steps: number = EMISSION_STEPS,
): number {
  const dir: [number, number, number] = [
    fragLocal[0] - camLocal[0],
    fragLocal[1] - camLocal[1],
    fragLocal[2] - camLocal[2],
  ];
  const a = dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2];
  const b = camLocal[0] * dir[0] + camLocal[1] * dir[1] + camLocal[2] * dir[2];
  const c = camLocal[0] * camLocal[0] + camLocal[1] * camLocal[1] + camLocal[2] * camLocal[2] - 1;
  const disc = b * b - a * c;
  if (disc < 0) return 0;
  const tEnter = Math.max((-b - Math.sqrt(disc)) / a, 0);
  if (tEnter >= 1) return 0;

  const sStart = Math.max(tEnter * worldPerT, EMISSION_S_MIN_PC);
  const sEnd = worldPerT;
  if (sStart >= sEnd) return 0;
  const logMin = Math.log(sStart);
  const logStep = (Math.log(sEnd) - logMin) / steps;

  let accum = 0;
  let prevS = sStart;
  for (let i = 0; i < steps; i++) {
    const sBoundary = Math.exp(logMin + (i + 1) * logStep);
    const sMid = Math.exp(logMin + (i + 0.5) * logStep);
    const dsPc = sBoundary - prevS;
    prevS = sBoundary;
    const t = sMid / worldPerT;
    const p: [number, number, number] = [
      camLocal[0] + t * dir[0],
      camLocal[1] + t * dir[1],
      camLocal[2] + t * dir[2],
    ];
    if (p[0] * p[0] + p[1] * p[1] + p[2] * p[2] > 1.001) break;
    accum += cpuDensityAt(p, e) * dsPc;
  }
  return accum;
}

/** Effective apparent magnitude of an integrated column — the shader's
 *  gate input, and (inverted) the calibration test's read-back path. */
export function magFromIntensity(intensity: number, glowMagOffset: number): number {
  return glowMagOffset - 2.5 * Math.log10(Math.max(intensity, 1e-12));
}

export function intensityFromMag(mag: number, glowMagOffset: number): number {
  return Math.pow(10, (glowMagOffset - mag) / 2.5);
}
