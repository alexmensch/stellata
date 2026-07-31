// Pure side of the LG emission renderer: emission-block → component
// decomposition, instance packing, flux ↔ magnitude inverse, and the
// CPU raymarch mirror — keep in lockstep with the .frag.glsl.

import { relativeLuminance } from '../hdr/tonemap-pure';
import { ARCSEC_TO_RAD } from '../util/astronomy-constants';
import type { LgEmission, LgObject } from './local-group-loader';

/** Population tints, seeded from the Milky Way palette (warm
 *  near-white bulge tone for old spheroid populations, pale lavender
 *  for discs). Per-object `emission.color` overrides. */
export const SPHEROID_COLOR_RGB: [number, number, number] = [1.0, 0.9647, 0.9294];
export const DISC_COLOR_RGB: [number, number, number] = [0.6706, 0.6588, 0.8745];

/** Surface-brightness zero point of a raymarched column, mag/arcsec².
 *
 *  The solver normalises `density0` against zero-point-free flux
 *  `F = 10^(−0.4·m_V)` (docs/science-local-group.md § Local Group
 *  luminosity model), and Φ = ∫∫ρ/s² dV = ∫(∫ρ ds) dΩ — so a column
 *  Σρ·ds IS flux per steradian, and the only conversion left is the
 *  solid angle of one arcsec². Nothing here is tunable: the emission
 *  scale is fixed the moment the solver runs. */
export const LG_SB_ZERO_POINT = -2.5 * Math.log10(ARCSEC_TO_RAD * ARCSEC_TO_RAD);

/** Projected radius, in CSS px, that a proxy mesh is expanded to when it
 *  would otherwise render smaller. Below one pixel the rasteriser cannot
 *  represent the source at all and quantised fragment coverage eats the
 *  flux — the same resolution floor `stellataPointSourcePeak` applies to
 *  a star's kernel. */
export const MIN_PROJECTED_RADIUS_PX = 1;

/**
 * Scale factor expanding a sub-pixel proxy mesh to the resolution floor.
 *
 * Applied as: axes × k, profile scale lengths × k, density0 ÷ k³. That
 * triple is flux-exact rather than approximately so — the column
 * ∫ρ ds picks up k from the path and k⁻³ from the density, and the solid
 * angle picks up k², so Φ is invariant while the image is the identical
 * profile magnified. k → 1 continuously at the floor, so there is no
 * cutover to hysteresis against.
 */
export function subPixelExpansion(meshRadiusPx: number): number {
  if (!(meshRadiusPx > 0)) return 1;
  return Math.max(1, MIN_PROJECTED_RADIUS_PX / meshRadiusPx);
}

/** Raymarch scheme shared by the GLSL shader and the CPU mirror. The
 *  disc pass marches denser: grazing rays run tens of kpc through an
 *  envelope whose vertical scale height is ~10² pc, and undersampling
 *  that profile bands. */
export const EMISSION_STEPS_SERSIC = 32;
export const EMISSION_STEPS_DISC = 64;
export const EMISSION_S_MIN_PC = 0.1;
/** Ellipsoidal-radius floor guarding the u^(−pn) central singularity. */
export const EMISSION_U_FLOOR = 1e-4;

/** One raymarched proxy volume. A Sérsic-family emission block is one
 *  component; a disc-family block is a disc component plus an optional
 *  spheroidal bulge component rendered in the Sérsic pass. */
export interface SersicComponent {
  family: 'sersic';
  /** Proxy-mesh half-extents, pc (= uMax × R_e per axis). */
  axesPc: [number, number, number];
  density0: number;
  invN: number;
  bn: number;
  pn: number;
  uMax: number;
}

export interface DiscComponent {
  family: 'disc';
  /** Proxy-mesh half-extents, pc (= rEnv, rEnv, zEnv). */
  axesPc: [number, number, number];
  density0: number;
  rdPc: number;
  zdPc: number;
}

export type EmissionComponent = SersicComponent | DiscComponent;

export function emissionComponents(e: LgEmission): EmissionComponent[] {
  if (e.family === 'disc') {
    const disc: DiscComponent = {
      family: 'disc',
      axesPc: [e.rEnvPc, e.rEnvPc, e.zEnvPc],
      density0: e.density0,
      rdPc: e.rdPc,
      zdPc: e.zdPc,
    };
    if (!e.bulge) return [disc];
    const b = e.bulge;
    return [disc, {
      family: 'sersic',
      axesPc: [b.uMax * b.reffAxesPc[0], b.uMax * b.reffAxesPc[1], b.uMax * b.reffAxesPc[2]],
      density0: b.density0,
      invN: 1 / b.n,
      bn: b.bn,
      pn: b.pn,
      uMax: b.uMax,
    }];
  }
  return [{
    family: 'sersic',
    axesPc: [e.uMax * e.reffAxesPc[0], e.uMax * e.reffAxesPc[1], e.uMax * e.reffAxesPc[2]],
    density0: e.density0,
    invN: 1 / e.n,
    bn: e.bn,
    pn: e.pn,
    uMax: e.uMax,
  }];
}

export function emissionStepsFor(comp: EmissionComponent): number {
  return comp.family === 'disc' ? EMISSION_STEPS_DISC : EMISSION_STEPS_SERSIC;
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

/** Tint divided by its own relative luminance, so it carries hue only.
 *
 *  The shader multiplies the scalar column by this per channel while the
 *  solver normalised that column against total flux — an un-normalised
 *  tint would therefore dim every object by its own luma (0.42 mag for
 *  the disc lavender) and silently break the solved magnitudes. */
export function lumaNormalisedTint(
  rgb: readonly [number, number, number],
): [number, number, number] {
  const y = relativeLuminance(rgb as [number, number, number]);
  if (!(y > 0)) return [1, 1, 1];
  return [rgb[0] / y, rgb[1] / y, rgb[2] / y];
}

function tintFor(e: LgEmission, comp: EmissionComponent): [number, number, number] {
  const override = e.color ? parseHexColor(e.color) : null;
  if (override) return lumaNormalisedTint(override);
  return lumaNormalisedTint(comp.family === 'disc' ? DISC_COLOR_RGB : SPHEROID_COLOR_RGB);
}

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
}

/** Decompose the catalog into per-family component lists and pack the
 *  per-instance attribute arrays both GPU passes consume. Pure —
 *  testable without a GL context. */
export function buildEmissionInstanceData(objects: readonly LgObject[]): {
  sersic: SersicInstanceData;
  disc: DiscInstanceData;
} {
  const sersicComps: { obj: LgObject; idx: number; comp: SersicComponent }[] = [];
  const discComps: { obj: LgObject; idx: number; comp: DiscComponent }[] = [];
  for (let i = 0; i < objects.length; i++) {
    for (const comp of emissionComponents(objects[i].emission)) {
      if (comp.family === 'disc') discComps.push({ obj: objects[i], idx: i, comp });
      else sersicComps.push({ obj: objects[i], idx: i, comp });
    }
  }

  const packCommon = (
    items: { obj: LgObject; idx: number; comp: EmissionComponent }[],
  ): EmissionInstanceCommon => {
    const n = items.length;
    const common: EmissionInstanceCommon = {
      count: n,
      centerAbs: new Float32Array(n * 3),
      quat: new Float32Array(n * 4),
      axes: new Float32Array(n * 3),
      color: new Float32Array(n * 3),
      objectIndex: items.map((it) => it.idx),
    };
    for (let k = 0; k < n; k++) {
      const { obj, comp } = items[k];
      common.centerAbs.set([obj.centerAbs.x, obj.centerAbs.y, obj.centerAbs.z], k * 3);
      common.quat.set([obj.quat.x, obj.quat.y, obj.quat.z, obj.quat.w], k * 4);
      common.color.set(tintFor(obj.emission, comp), k * 3);
      common.axes.set(comp.axesPc, k * 3);
    }
    return common;
  };

  const sersic: SersicInstanceData = {
    ...packCommon(sersicComps),
    sersic: new Float32Array(sersicComps.length * 4),
    uMax: new Float32Array(sersicComps.length),
  };
  for (let k = 0; k < sersicComps.length; k++) {
    const c = sersicComps[k].comp;
    sersic.sersic.set([c.density0, c.invN, c.bn, c.pn], k * 4);
    sersic.uMax[k] = c.uMax;
  }

  const disc: DiscInstanceData = {
    ...packCommon(discComps),
    disc: new Float32Array(discComps.length * 3),
  };
  for (let k = 0; k < discComps.length; k++) {
    const c = discComps[k].comp;
    disc.disc.set([c.density0, 1 / c.rdPc, 1 / c.zdPc], k * 3);
  }

  return { sersic, disc };
}

/** Deprojected Sérsic density with the same U_FLOOR clamp the shader
 *  applies. */
export function cpuSersicNu(u: number, invN: number, bn: number, pn: number): number {
  const uc = Math.max(u, EMISSION_U_FLOOR);
  return Math.pow(uc, -pn) * Math.exp(-bn * Math.pow(uc, invN));
}

/** Density at a unit-ball point for one emission component — the CPU
 *  twin of the shader's densityAt. pLocal is in the component's
 *  unit-ball frame. */
export function cpuDensityAt(
  pLocal: [number, number, number],
  comp: EmissionComponent,
): number {
  if (comp.family === 'disc') {
    const R = Math.hypot(pLocal[0] * comp.axesPc[0], pLocal[1] * comp.axesPc[1]);
    const z = pLocal[2] * comp.axesPc[2];
    return comp.density0 * Math.exp(-R / comp.rdPc - Math.abs(z) / comp.zdPc);
  }
  const u = Math.hypot(pLocal[0], pLocal[1], pLocal[2]) * comp.uMax;
  return comp.density0 * cpuSersicNu(u, comp.invN, comp.bn, comp.pn);
}

/** CPU mirror of the fragment shader's bounded raymarch: unit-sphere
 *  entry/exit from `camLocal` toward the back-face point `fragLocal`
 *  (on the unit sphere), log-distributed samples, Σ ρ·ds in F·pc
 *  column units. Returns 0 when the ray misses. `worldPerT` is the
 *  world-pc length of one t-unit (|fragWorld − cameraWorld|).
 *  Samples sit at step midpoints; the shader jitters them per-pixel
 *  (uniform over the step, same expectation). */
export function cpuRaymarchColumn(
  camLocal: [number, number, number],
  fragLocal: [number, number, number],
  worldPerT: number,
  comp: EmissionComponent,
  steps: number = emissionStepsFor(comp),
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
    accum += cpuDensityAt(p, comp) * dsPc;
  }
  return accum;
}

/** Magnitude of an integrated flux number, and its inverse. `zeroPoint`
 *  is 0 for a solid-angle-integrated flux (the calibration test's
 *  read-back) and LG_SB_ZERO_POINT for a per-arcsec² column. */
export function magFromIntensity(intensity: number, zeroPoint: number): number {
  return zeroPoint - 2.5 * Math.log10(Math.max(intensity, 1e-12));
}

export function intensityFromMag(mag: number, zeroPoint: number): number {
  return Math.pow(10, (zeroPoint - mag) / 2.5);
}

/** Surface brightness a raymarched column carries, mag/arcsec². */
export function columnSurfaceBrightness(column: number): number {
  return magFromIntensity(column, LG_SB_ZERO_POINT);
}
