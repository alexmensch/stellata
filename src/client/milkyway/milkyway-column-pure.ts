// Milky Way density / dust profiles and a CPU mirror of
// milkyway.frag.glsl's raymarch. Owns the physical constants the shader
// receives as uniforms — see README.md § Density profiles, § Calibration.

import { R0_PC } from '../galactic/galactic-coords';
import { SB_ZERO_POINT, lumaNormalisedTint } from '../hdr/emission-pure';
import { NGP_DIFFUSE_RESIDUAL_MAG_ARCSEC2 } from './diffuse-reference';
import { type Rgb, relativeLuminance } from '../hdr/tonemap-pure';

export type Vec3 = readonly [number, number, number];

// --- Disc component ----------------------------------------------------

export const DISC_RADIUS_PC = 15_000;
export const DISC_HALF_THICKNESS_PC = 600;
export const DISC_SCALE_LENGTH_PC = 3_000;
export const DISC_SCALE_HEIGHT_PC = 300;
export const DISC_WEIGHT = 1.5;
export const DISC_COLOR_RGB: Rgb = [0.6706, 0.6588, 0.8745];
/** The authored palette carrying hue only — what the shader multiplies in.
 *  See README.md § Population tints carry hue, never flux. */
export const DISC_TINT_RGB: Rgb = lumaNormalisedTint(DISC_COLOR_RGB);

// --- Bulge component ---------------------------------------------------

export const BULGE_RADIUS_PC = 5_000;
export const BULGE_HALF_THICKNESS_PC = 3_000;
export const BULGE_SCALE_RADIUS_PC = 1_000;
export const BULGE_AXIS_RATIO = 0.6;
export const BULGE_WEIGHT = 18.0;
export const BULGE_COLOR_RGB: Rgb = [1.0, 0.9647, 0.9294];
export const BULGE_TINT_RGB: Rgb = lumaNormalisedTint(BULGE_COLOR_RGB);

// --- Analytical dust ---------------------------------------------------

export const ANALYTICAL_DUST_SCALE_LENGTH_PC = 3_500;
export const ANALYTICAL_DUST_SCALE_HEIGHT_PC = 125;

/** V-band extinction the slab produces per kpc at (R₀, z = 0) — the
 *  declarative dust anchor, from which the normalisation is derived.
 *  1.0 mag/kpc is the upper end of the range commonly adopted for the
 *  solar-neighbourhood plane (0.7–1.0; the historical low-|b| figure runs
 *  to 1.8). Two independent constraints meet here: at the 125 pc scale
 *  height it also puts the perpendicular column to the pole at
 *  A_V = 0.125, inside the SFD polar spread. See README.md § Analytical
 *  dust. */
export const LOCAL_DUST_RATE_MAG_PER_KPC = 1.0;

export const REDDENING_RGB: Rgb = [0.76, 1.0, 1.35];

/** `avPerDensityPerPc` from the dust manifest (ZGR_TO_AV). `attachDust`
 *  overwrites the uniform from the loaded field; this is the value the
 *  shipped artifact carries and the one the calibration is derived at. */
export const DEFAULT_DUST_AV_PER_DENSITY_PC = 2.742;

export const ANALYTICAL_DUST_NORM_PER_PC =
  LOCAL_DUST_RATE_MAG_PER_KPC / (DEFAULT_DUST_AV_PER_DENSITY_PC * 1000);

/** The dust multiplier is a dev lever, not a calibration term — the
 *  normalisation above is the calibration. Anything but 1 means the
 *  shipped extinction disagrees with its own stated anchor. */
export const DEFAULT_EXTINCTION_STRENGTH = 1.0;

export const MAG_PER_TAU = 1.0857;

// --- Raymarch resolution (mirrors the GLSL consts) ---------------------

export const STEPS = 32;
export const S_MIN_PC = 1;

/** Steps in the camera→mesh-boundary dust pre-march. Linear rather than
 *  log-distributed: the span's integrand rises monotonically toward the
 *  far end (the boundary), which is the opposite of the in-volume march's
 *  distribution. Sized for oblique crossings of the 125 pc dust slab, not
 *  for the in-plane case — `milkyway-column-pure.test.ts` pins both
 *  against a converged reference march. */
export const FOREGROUND_DUST_STEPS = 16;

// --- Profiles ----------------------------------------------------------

/** Disc emissivity at the component's RELATIVE weight. `EMISSIVITY_SCALE`
 *  puts it in the shared flux unit and is derived from a march of this
 *  profile, so it cannot be baked in here. */
export function discDensity(rPc: number, zPc: number): number {
  return (
    DISC_WEIGHT *
    Math.exp(-(rPc - R0_PC) / DISC_SCALE_LENGTH_PC) *
    Math.exp(-Math.abs(zPc) / DISC_SCALE_HEIGHT_PC)
  );
}

export function bulgeDensity(rPc: number, zPc: number): number {
  const zEff = zPc / BULGE_AXIS_RATIO;
  const rPrime = Math.sqrt(rPc * rPc + zEff * zEff);
  return BULGE_WEIGHT * Math.exp(-rPrime / BULGE_SCALE_RADIUS_PC);
}

export function analyticalDustDensity(rPc: number, zPc: number): number {
  return (
    ANALYTICAL_DUST_NORM_PER_PC *
    Math.exp(-(rPc - R0_PC) / ANALYTICAL_DUST_SCALE_LENGTH_PC) *
    Math.exp(-Math.abs(zPc) / ANALYTICAL_DUST_SCALE_HEIGHT_PC)
  );
}

/** V-band optical depth per parsec at a galactocentric point. */
export function dustTauVPerPc(
  rPc: number,
  zPc: number,
  extinctionStrength: number,
  avPerDensityPc = DEFAULT_DUST_AV_PER_DENSITY_PC,
): number {
  return (
    (analyticalDustDensity(rPc, zPc) * avPerDensityPc * extinctionStrength) /
    MAG_PER_TAU
  );
}

export interface MilkywayComponent {
  readonly name: 'disc' | 'bulge';
  readonly meshScalePc: Vec3;
  readonly colorRgb: Rgb;
  readonly density: (rPc: number, zPc: number) => number;
}

export const DISC_COMPONENT: MilkywayComponent = {
  name: 'disc',
  meshScalePc: [DISC_RADIUS_PC, DISC_RADIUS_PC, DISC_HALF_THICKNESS_PC],
  colorRgb: DISC_TINT_RGB,
  density: discDensity,
};

export const BULGE_COMPONENT: MilkywayComponent = {
  name: 'bulge',
  meshScalePc: [BULGE_RADIUS_PC, BULGE_RADIUS_PC, BULGE_HALF_THICKNESS_PC],
  colorRgb: BULGE_TINT_RGB,
  density: bulgeDensity,
};

export const MILKYWAY_COMPONENTS: readonly MilkywayComponent[] = [
  DISC_COMPONENT,
  BULGE_COMPONENT,
];

// --- Geometry ----------------------------------------------------------

/** Sol in the galactocentric galactic frame the shader marches in: the
 *  Galactic centre sits at +X, so Sol is at −R₀ along it. */
export const SOL_GALACTOCENTRIC_PC: Vec3 = [-R0_PC, 0, 0];

/** Unit galactic direction for a sightline in degrees. */
export function galacticDirection(lDeg: number, bDeg: number): Vec3 {
  const l = (lDeg * Math.PI) / 180;
  const b = (bDeg * Math.PI) / 180;
  return [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)];
}

export interface MeshSpanPc {
  /** Distance to the front face, clamped to 0 when the origin is inside. */
  readonly sNear: number;
  readonly sFar: number;
}

/**
 * Entry / exit distances in parsecs where a ray meets a component's proxy
 * ellipsoid. Mirrors the shader's unit-sphere intersection in the
 * axis-divided mesh-local frame; `dirUnit` being unit-length in
 * galactocentric pc is what makes the roots physical distances.
 */
export function meshSpanPc(
  originPc: Vec3,
  dirUnit: Vec3,
  meshScalePc: Vec3,
): MeshSpanPc | null {
  let a = 0;
  let b = 0;
  let c = -1;
  for (let i = 0; i < 3; i++) {
    const o = originPc[i] / meshScalePc[i];
    const d = dirUnit[i] / meshScalePc[i];
    a += d * d;
    b += o * d;
    c += o * o;
  }
  const disc = b * b - a * c;
  if (disc <= 0) return null;
  const root = Math.sqrt(disc);
  const sFar = (-b + root) / a;
  if (sFar <= 0) return null;
  return { sNear: Math.max((-b - root) / a, 0), sFar };
}

function pointAt(originPc: Vec3, dirUnit: Vec3, sPc: number): Vec3 {
  return [
    originPc[0] + sPc * dirUnit[0],
    originPc[1] + sPc * dirUnit[1],
    originPc[2] + sPc * dirUnit[2],
  ];
}

function cylindrical(p: Vec3): { rPc: number; zPc: number } {
  return { rPc: Math.hypot(p[0], p[1]), zPc: p[2] };
}

// --- Dust columns ------------------------------------------------------

function tauStepRgb(
  rPc: number,
  zPc: number,
  dsPc: number,
  extinctionStrength: number,
): [number, number, number] {
  const kappa = dustTauVPerPc(rPc, zPc, extinctionStrength);
  return [
    kappa * REDDENING_RGB[0] * dsPc,
    kappa * REDDENING_RGB[1] * dsPc,
    kappa * REDDENING_RGB[2] * dsPc,
  ];
}

/**
 * Per-channel optical depth of the dust between the camera and a
 * component's proxy boundary. The integration volume starts at the mesh
 * front face; the dust slab does not, so a component the camera sits
 * outside of emits through this column before its own march begins.
 *
 * @param steps overridable so the test can march a converged reference.
 */
export function foregroundDustTauRgb(
  originPc: Vec3,
  dirUnit: Vec3,
  sStartPc: number,
  extinctionStrength: number,
  steps = FOREGROUND_DUST_STEPS,
): [number, number, number] {
  const tau: [number, number, number] = [0, 0, 0];
  if (extinctionStrength <= 0 || sStartPc <= S_MIN_PC) return tau;
  const dsPc = (sStartPc - S_MIN_PC) / steps;
  for (let i = 0; i < steps; i++) {
    const sMid = S_MIN_PC + (i + 0.5) * dsPc;
    const { rPc, zPc } = cylindrical(pointAt(originPc, dirUnit, sMid));
    const d = tauStepRgb(rPc, zPc, dsPc, extinctionStrength);
    for (let k = 0; k < 3; k++) tau[k] += d[k];
  }
  return tau;
}

// --- Emission column ---------------------------------------------------

export interface ColumnOptions {
  readonly extinctionStrength?: number;
  /** False mirrors `uDustEnabled = 0` (no dust field attached). */
  readonly dustEnabled?: boolean;
  /** Steps in the in-volume march. Raise for a converged reference. */
  readonly steps?: number;
  /** Steps in the foreground pre-march. 0 reproduces the pre-fix shader,
   *  which seeded τ at the mesh boundary and skipped this column. */
  readonly foregroundSteps?: number;
}

/**
 * One component's dust-attenuated emission column, in the component's
 * **relative weight** units. Mirrors milkyway.frag.glsl: log-distributed
 * steps from the front face (or `S_MIN_PC` when inside) to the back face,
 * Beer-Lambert attenuation with half-step self-shielding, seeded with the
 * foreground dust column.
 *
 * Every column function here is weight-space. `EMISSIVITY_SCALE` enters
 * exactly once, in `sightlineEmissionColumn` — the march is linear in it,
 * and the scale is derived from a march, so it cannot appear inside one.
 */
export function componentColumnRgb(
  component: MilkywayComponent,
  originPc: Vec3,
  dirUnit: Vec3,
  options: ColumnOptions = {},
): [number, number, number] {
  const {
    extinctionStrength = DEFAULT_EXTINCTION_STRENGTH,
    dustEnabled = true,
    steps = STEPS,
    foregroundSteps = FOREGROUND_DUST_STEPS,
  } = options;
  const dustEffective = dustEnabled ? extinctionStrength : 0;

  const accum: [number, number, number] = [0, 0, 0];
  const span = meshSpanPc(originPc, dirUnit, component.meshScalePc);
  if (span === null) return accum;

  const sStart = Math.max(span.sNear, S_MIN_PC);
  const sEnd = span.sFar;
  if (sStart >= sEnd) return accum;

  const tau = foregroundDustTauRgb(
    originPc,
    dirUnit,
    sStart,
    dustEffective,
    foregroundSteps,
  );

  const logMin = Math.log(sStart);
  const logStep = (Math.log(sEnd) - logMin) / steps;
  let prevS = sStart;

  for (let i = 0; i < steps; i++) {
    const sBoundary = Math.exp(logMin + (i + 1) * logStep);
    const sMid = Math.exp(logMin + (i + 0.5) * logStep);
    const dsPc = sBoundary - prevS;
    prevS = sBoundary;

    const p = pointAt(originPc, dirUnit, sMid);
    let outside = -1;
    for (let k = 0; k < 3; k++) {
      const local = p[k] / component.meshScalePc[k];
      outside += local * local;
    }
    if (outside > 0.001) break;

    const { rPc, zPc } = cylindrical(p);
    const density = component.density(rPc, zPc);
    const dTau = tauStepRgb(rPc, zPc, dsPc, dustEffective);

    for (let k = 0; k < 3; k++) {
      const transmittance = Math.exp(-tau[k]) * Math.exp(-0.5 * dTau[k]);
      accum[k] += density * component.colorRgb[k] * transmittance * dsPc;
      tau[k] += dTau[k];
    }
  }
  return accum;
}

/** Both components' columns summed — what one band pixel accumulates
 *  across the two additively-blended meshes. */
export function sightlineColumnRgb(
  originPc: Vec3,
  dirUnit: Vec3,
  options: ColumnOptions = {},
): [number, number, number] {
  const total: [number, number, number] = [0, 0, 0];
  for (const component of MILKYWAY_COMPONENTS) {
    const c = componentColumnRgb(component, originPc, dirUnit, options);
    for (let k = 0; k < 3; k++) total[k] += c[k];
  }
  return total;
}

/** The luminance-weighted column in weight space — scale-free, so a
 *  ratio of two of these is meaningful on its own. */
export function sightlineColumn(
  originPc: Vec3,
  dirUnit: Vec3,
  options: ColumnOptions = {},
): number {
  return relativeLuminance(sightlineColumnRgb(originPc, dirUnit, options));
}

// --- Emission scale ----------------------------------------------------

/**
 * Multiplier taking the components' relative weights to the shared
 * `SB_ZERO_POINT` flux unit, derived so the NGP sightline lands on the
 * anchor above. Marched **dust-free**, which is the whole point: the
 * emissivity is an intrinsic property and must not move when the
 * extinction does.
 *
 * Interim: one sightline, not an integrated luminosity, so the model's own
 * total M_V is a reported outcome rather than an input. See README.md
 * § Calibration for the solve that replaces this and why it waits.
 */
export const EMISSIVITY_SCALE =
  10 ** (-0.4 * (NGP_DIFFUSE_RESIDUAL_MAG_ARCSEC2 - SB_ZERO_POINT)) /
  sightlineColumn(SOL_GALACTOCENTRIC_PC, galacticDirection(0, 90), {
    dustEnabled: false,
  });

/** Per-component emissivity in the shared flux unit — what the shader
 *  receives as `density0`. */
export const DISC_DENSITY0 = DISC_WEIGHT * EMISSIVITY_SCALE;
export const BULGE_DENSITY0 = BULGE_WEIGHT * EMISSIVITY_SCALE;

/** The column the shader turns into surface brightness via
 *  `S = uGlowMagOffset − 2.5·log10(column)`: the weight-space march in
 *  the shared flux unit. Declared below `EMISSIVITY_SCALE` so no march
 *  can reach the scale before it exists. */
export function sightlineEmissionColumn(
  originPc: Vec3,
  dirUnit: Vec3,
  options: ColumnOptions = {},
): number {
  return EMISSIVITY_SCALE * sightlineColumn(originPc, dirUnit, options);
}

/** Surface brightness in mag/arcsec² for a sightline. */
export function sightlineSurfaceBrightness(
  glowMagOffset: number,
  originPc: Vec3,
  dirUnit: Vec3,
  options: ColumnOptions = {},
): number {
  return (
    glowMagOffset -
    2.5 * Math.log10(sightlineEmissionColumn(originPc, dirUnit, options))
  );
}
