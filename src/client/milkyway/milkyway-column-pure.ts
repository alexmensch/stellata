// Milky Way density / dust profiles and a CPU mirror of
// milkyway.frag.glsl's raymarch. Owns the constants the shader receives as
// uniforms — README.md § Density profiles, calibration/README.md.

import { R0_PC } from '../galactic/galactic-coords';
import {
  footprintAlong,
  footprintRadiusPc,
  lumaNormalisedTint,
  softenRadius,
} from '../hdr/emission/emission-pure';
import {
  ABSOLUTE_MAGNITUDE_DISTANCE_PC,
  fluxNumber,
  integrateOverEllipsoidRz,
  solveDensity0,
} from '../hdr/emission/density0-solver-pure';
import {
  BULGE_TO_TOTAL_LIGHT_V,
  DISC_COLOUR_INDEX_BV,
  GALAXY_TOTAL_ABSMAG_V,
} from './calibration/diffuse-reference';
import { OLD_SPHEROID_COLOR_RGB } from '../hdr/emission/population-colour-pure';
import { linearSrgbFromColourIndex } from '../../../scripts/colour/blackbody-lut-pure';
import { type Rgb, relativeLuminance } from '../hdr/tonemap-pure';

export type Vec3 = readonly [number, number, number];

// --- Disc component ----------------------------------------------------

export const DISC_RADIUS_PC = 15_000;
/** Two thick scale heights — the same rule the 600 pc envelope followed
 *  against the thin one, moved to the component that now sets the extent.
 *  See README.md § Density profiles for the truncation it costs. */
export const DISC_HALF_THICKNESS_PC = 1_800;
export const DISC_SCALE_LENGTH_PC = 3_000;
export const DISC_SCALE_HEIGHT_PC = 300;

/** Thick disc, Bland-Hawthorn & Gerhard 2016 § 5.1: z_T = 900 ± 180 pc
 *  carrying f_ρ = 4 ± 2 % of the local density at the midplane. Shares the
 *  thin disc's radial scale length, which is the one place this departs
 *  from the literature — see README.md § Density profiles. */
export const DISC_THICK_SCALE_HEIGHT_PC = 900;
export const DISC_THICK_DENSITY_FRACTION = 0.04;

export const DISC_COLOR_RGB: Rgb = linearSrgbFromColourIndex(DISC_COLOUR_INDEX_BV);
/** The authored palette carrying hue only — what the shader multiplies in.
 *  See README.md § Population tints carry hue, never flux. */
export const DISC_TINT_RGB: Rgb = lumaNormalisedTint(DISC_COLOR_RGB);

// --- Bulge component ---------------------------------------------------

export const BULGE_RADIUS_PC = 5_000;
export const BULGE_HALF_THICKNESS_PC = 3_000;
export const BULGE_SCALE_RADIUS_PC = 1_000;
export const BULGE_AXIS_RATIO = 0.6;
export const BULGE_COLOR_RGB: Rgb = OLD_SPHEROID_COLOR_RGB;
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

/** Thin plus thick exponential, at an already-softened |z|. */
export function discVerticalProfile(absZPc: number): number {
  return (
    Math.exp(-absZPc / DISC_SCALE_HEIGHT_PC) +
    DISC_THICK_DENSITY_FRACTION *
      Math.exp(-absZPc / DISC_THICK_SCALE_HEIGHT_PC)
  );
}

/** Both profiles' SHAPE at unit ρ₀. The disc's radial term is 1 at R₀ and
 *  its vertical term is 1 + f_ρ at the midplane, so `DISC_DENSITY0` is a
 *  solved scale rather than the emissivity at any particular point; the
 *  bulge's is 1 at the centre. The volume integrals below march the shape,
 *  so neither may reach a `density0` it is mid-way through deriving. */
function discShape(
  rPc: number,
  zPc: number,
  footprintPc = 0,
  zFootprintPc = 0,
): number {
  return (
    Math.exp(-(softenRadius(rPc, footprintPc) - R0_PC) / DISC_SCALE_LENGTH_PC) *
    discVerticalProfile(softenRadius(Math.abs(zPc), zFootprintPc))
  );
}

function bulgeShape(rPc: number, zPc: number, footprintPc = 0): number {
  const zEff = zPc / BULGE_AXIS_RATIO;
  const rPrime = softenRadius(Math.sqrt(rPc * rPc + zEff * zEff), footprintPc);
  return Math.exp(-rPrime / BULGE_SCALE_RADIUS_PC);
}

/** ∫ shape dV over the component's own proxy ellipsoid, in pc³. The
 *  shapes are scalars against luma-normalised tints, so this is the
 *  LUMINANCE integral and a flux share can be split between the two
 *  without either hue moving light
 *  (`../hdr/emission/README.md` § Solving ρ₀). */
export const DISC_VOLUME_INTEGRAL = integrateOverEllipsoidRz(
  discShape,
  DISC_RADIUS_PC,
  DISC_HALF_THICKNESS_PC,
);

export const BULGE_VOLUME_INTEGRAL = integrateOverEllipsoidRz(
  bulgeShape,
  BULGE_RADIUS_PC,
  BULGE_HALF_THICKNESS_PC,
);

/**
 * Each component's emissivity in the shared flux unit — what the shader
 * receives as `uDensity0`. Solved so the two proxy volumes integrate to
 * the Galaxy's published M_V at its V-band LIGHT B/T, the same
 * `ρ₀ = d²·F/G` the Local Group solves per object, with d = 10 pc because
 * the anchor is an absolute magnitude.
 *
 * **Zero free parameters, and no march feeds the calibration** — the
 * relative component weights the sightline anchor needed are gone with
 * it. Truncation compensation rides along: G is over the ACTUAL mesh
 * volume, so the 0.076 mag the disc envelope clips against all space is
 * redistributed inward rather than lost (calibration/README.md).
 */
export const DISC_DENSITY0 = solveDensity0(
  ABSOLUTE_MAGNITUDE_DISTANCE_PC,
  fluxNumber(GALAXY_TOTAL_ABSMAG_V) * (1 - BULGE_TO_TOTAL_LIGHT_V),
  DISC_VOLUME_INTEGRAL,
);

export const BULGE_DENSITY0 = solveDensity0(
  ABSOLUTE_MAGNITUDE_DISTANCE_PC,
  fluxNumber(GALAXY_TOTAL_ABSMAG_V) * BULGE_TO_TOTAL_LIGHT_V,
  BULGE_VOLUME_INTEGRAL,
);

export function discDensity(
  rPc: number,
  zPc: number,
  footprintPc = 0,
  zFootprintPc = 0,
): number {
  return DISC_DENSITY0 * discShape(rPc, zPc, footprintPc, zFootprintPc);
}

export function bulgeDensity(rPc: number, zPc: number, footprintPc = 0): number {
  return BULGE_DENSITY0 * bulgeShape(rPc, zPc, footprintPc);
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
  /** The bulge is a spheroid, so its footprint softening is isotropic and it
   *  ignores the fourth argument — `stellataSoftenRadius` on an ellipsoidal
   *  radius is already transverse. */
  readonly density: (
    rPc: number,
    zPc: number,
    footprintPc?: number,
    zFootprintPc?: number,
  ) => number;
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
  /** Turns on the footprint softening the shader always applies. Omit for a
   *  march with no plate scale — a sightline column is defined without one,
   *  and from Sol the footprint is metres against a 300 pc scale height. */
  readonly omegaPxArcsec2?: number;
}

/**
 * One component's dust-attenuated emission column, in the shared flux
 * unit. Mirrors milkyway.frag.glsl: log-distributed steps from the front
 * face (or `S_MIN_PC` when inside) to the back face, Beer-Lambert
 * attenuation with half-step self-shielding, seeded with the foreground
 * dust column.
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
    omegaPxArcsec2 = 0,
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
  const zFootprintScale =
    omegaPxArcsec2 > 0 ? footprintAlong(dirUnit, [0, 0, 1]) : 0;

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
    const footprintPc = omegaPxArcsec2 > 0 ? footprintRadiusPc(sMid, omegaPxArcsec2) : 0;
    const density = component.density(
      rPc,
      zPc,
      footprintPc,
      footprintPc * zFootprintScale,
    );
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

/** One component's share of the luminance a pixel accumulates across both
 *  meshes — the flux split as the camera sees it, after dust, rather than
 *  the `density0` split that produced it. */
export function componentLuminanceShare(
  component: MilkywayComponent,
  originPc: Vec3,
  dirUnit: Vec3,
  options: ColumnOptions = {},
): number {
  let own = 0;
  let total = 0;
  for (const c of MILKYWAY_COMPONENTS) {
    const lum = relativeLuminance(componentColumnRgb(c, originPc, dirUnit, options));
    if (c === component) own = lum;
    total += lum;
  }
  return own / total;
}

/** The luminance-weighted column, in the shared flux unit — what the
 *  shader turns into surface brightness via
 *  `S = uGlowMagOffset − 2.5·log10(column)`. */
export function sightlineColumn(
  originPc: Vec3,
  dirUnit: Vec3,
  options: ColumnOptions = {},
): number {
  return relativeLuminance(sightlineColumnRgb(originPc, dirUnit, options));
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
    2.5 * Math.log10(sightlineColumn(originPc, dirUnit, options))
  );
}
