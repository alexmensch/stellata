// See /docs/science-molecular-clouds.md#4-per-cloud-density-model--the-presence-pass-field.

import { AV_PER_NH_PC } from '../../src/astro-core/baker-constants';
import { cloudEnvelope, plummerProfile } from '../../src/astro-core/cloud-density-pure';
import { GAL_TO_ICRS } from '../../src/astro-core/galactic-coords';
import { Vector3 } from 'three';
import type { CloudClass, CloudNoiseModel } from '../../src/catalog-format/clouds/clouds-schema';
import type { PlummerFit, Z2021Extent, Z2021Mass } from './zucker-parse';

export type Vec3 = readonly [number, number, number];
export type Mat3 = readonly [Vec3, Vec3, Vec3];

/** Cardelli 1989 (/data/papers/index.md#cardelli1989) eq. 2 at 2.159 µm (2MASS Ks), R_V = 3.1 — not its
 *  Table 3 K row, which gives 0.114. */
export const AK_OVER_AV = 0.117;

const MU = 1.37;
const M_H_G = 1.6735575e-24;
const PC_CM = 3.0856775814913673e18;
const MSUN_G = 1.98892e33;
/** M/M☉ = this · ∫ n dV, n in cm⁻³ and V in pc³, μ = 1.37 per H nucleon. */
export const MSUN_PER_NH_PC3 = (MU * M_H_G * PC_CM ** 3) / MSUN_G;

/** Fraction of the envelope radius where the density taper begins. */
export const ENVELOPE_FADE_START = 0.85;

/** Floor on every semi-axis and sphere radius: a degenerate flat box (Musca's is 0.5 pc thin) would render
 *  invisibly edge-on. */
export const MIN_AXIS_PC = 3.0;

/** The calibrated model may hold at most this multiple of Table 3's `mass_leike` before its envelope tightens. */
export const MASS_CAP_FACTOR = 2.0;

export const SIGMA_S_BY_CLASS: Readonly<Record<CloudClass, number>> = { dark: 1.3, sf: 1.7, hii: 1.9 };
export const AV_TARGET_BY_CLASS: Readonly<Record<CloudClass, number>> = { dark: 2.0, sf: 3.0, hii: 4.0 };
export const SPHERE_RFLAT_FRACTION = 0.25;
export const SPHERE_PLUMMER_P = 2.0;

/** Curated class by raw table name (/docs/science-molecular-clouds.md#71-classes); unlisted clouds are dark. */
const CLOUD_CLASS: Readonly<Record<string, CloudClass>> = {
  Chamaeleon: 'dark',
  Ophiuchus: 'sf',
  Lupus: 'dark',
  Taurus: 'dark',
  Perseus: 'sf',
  Musca: 'dark',
  Pipe: 'dark',
  Cepheus: 'dark',
  Coraus: 'sf',
  Oriona: 'hii',
  Orionb: 'hii',
  Orionlam: 'hii',
  Carina: 'hii',
  W3: 'hii',
  W4: 'hii',
  W5: 'hii',
  M16: 'hii',
  M17: 'hii',
  Rosette: 'hii',
  IC2944: 'hii',
  NGC6604: 'hii',
  Gem_OB1: 'hii',
  IC443: 'hii',
};

export function cloudClass(rawName: string): CloudClass {
  return Object.hasOwn(CLOUD_CLASS, rawName) ? CLOUD_CLASS[rawName] : 'dark';
}

/** The substructure noise ladder (/docs/science-molecular-clouds.md#5-substructure-noise-build-side-spec),
 *  exported whole as clouds.json's `noiseModel`. */
export const NOISE_MODEL: CloudNoiseModel = {
  lacunarity: 2.0,
  betaSpectral: 2.0,
  lambdaMinPc: 0.3,
  domainStretchMajor: 2.5,
  noiseClampSigma: 2.5,
  ridgedFinestCount: 2,
  ridgedExponent: { dark: 2.0, sf: 3.0, hii: 3.0 },
  sigmaS: SIGMA_S_BY_CLASS,
  hash: 'pcg3d',
  interp: 'quintic',
};

/** `GAL_TO_ICRS` as rows: row i, column j is ICRS component i of galactic basis vector j. */
export const GAL_TO_ICRS_ROWS: Mat3 = (() => {
  const e = GAL_TO_ICRS.elements;
  const row = (i: number): Vec3 => [e[i], e[4 + i], e[8 + i]];
  return [row(0), row(1), row(2)];
})();

export function galToIcrs(v: Vec3): Vec3 {
  const p = new Vector3(...v).applyMatrix4(GAL_TO_ICRS);
  return [p.x, p.y, p.z];
}

/** Deterministic 32-bit FNV-1a noise seed over the UTF-8 bytes of `s`. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(s)) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  return h;
}

/** ∫ plummer(|l|) · envelope(|l| / sMin) dl along the shortest-axis chord through the centroid, pc, unit
 *  amplitude. Trapezoid rule. */
export function columnIntegralPc(rflat: number, p: number, sMin: number, uEnv = 1, nSamples = 4001): number {
  const half = sMin * uEnv;
  const h = (2 * half) / (nSamples - 1);
  let total = 0;
  for (let i = 0; i < nSamples; i++) {
    const l = Math.abs(-half + i * h);
    const f = plummerProfile(l, rflat, p) * cloudEnvelope(l / sMin, uEnv, ENVELOPE_FADE_START);
    total += i > 0 && i < nSamples - 1 ? f : 0.5 * f;
  }
  return total * h;
}

/** ∫ plummer(r_eff) · envelope(u) dV over the ellipsoid, pc³, unit amplitude. In unit-ball coordinates
 *  w = x / axes, dV = abc·dw and r_eff = |w|·sMin. Trapezoid rule over the shells. */
export function volumeIntegralPc3(rflat: number, p: number, axes: Vec3, uEnv = 1, nSamples = 4001): number {
  const sMin = Math.min(...axes);
  const h = uEnv / (nSamples - 1);
  let total = 0;
  for (let i = 0; i < nSamples; i++) {
    const u = i * h;
    const f = plummerProfile(u * sMin, rflat, p) * cloudEnvelope(u, uEnv, ENVELOPE_FADE_START) * u * u;
    total += i > 0 && i < nSamples - 1 ? f : 0.5 * f;
  }
  return axes[0] * axes[1] * axes[2] * (4 * Math.PI * total * h);
}

export interface Calibration {
  /** Amplitude, cm⁻³. */
  readonly n0Cal: number;
  /** Envelope radius; 1 is the full bounding-box ellipsoid. */
  readonly uEnv: number;
  /** M☉. */
  readonly massModel: number;
}

/** n0Cal sets the centroid shortest-axis column to `targetAv` at the solved envelope; uEnv drops below 1
 *  only when the full-box model exceeds MASS_CAP_FACTOR × massLeike. Mass is monotonic in uEnv, so a
 *  bisection converges (/docs/science-molecular-clouds.md#42-calibration-procedure-per-cloud). */
export function calibrate(fit: PlummerFit, axes: Vec3, targetAv: number, massLeike: number): Calibration {
  const sMin = Math.min(...axes);
  const cap = MASS_CAP_FACTOR * massLeike;
  const solveAt = (uEnv: number): Calibration => {
    const n0Cal = targetAv / (AV_PER_NH_PC * columnIntegralPc(fit.rflat, fit.p, sMin, uEnv));
    return { n0Cal, uEnv, massModel: MSUN_PER_NH_PC3 * n0Cal * volumeIntegralPc3(fit.rflat, fit.p, axes, uEnv) };
  };
  const full = solveAt(1);
  if (full.massModel <= cap) return full;
  let lo = 0.05;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    if (solveAt(mid).massModel > cap) hi = mid;
    else lo = mid;
  }
  return solveAt(lo);
}

/** Centroid and floored semi-axes of a Table 1 box, both in the galactic frame. */
export function extentGeometry(e: Z2021Extent): { centreGal: Vec3; axesGal: Vec3 } {
  const half = (lo: number, hi: number): number => Math.max(0.5 * (hi - lo), MIN_AXIS_PC);
  return {
    centreGal: [0.5 * (e.xmin + e.xmax), 0.5 * (e.ymin + e.ymax), 0.5 * (e.zmin + e.zmax)],
    axesGal: [half(e.xmin, e.xmax), half(e.ymin, e.ymax), half(e.zmin, e.zmax)],
  };
}

/** One of the Zucker 2021 clouds with a Table 2 Plummer fit and Table 3 masses. */
export interface ProfiledCloud {
  readonly rawName: string;
  readonly centreIcrsPc: Vec3;
  readonly axesGalPc: Vec3;
  readonly fit: PlummerFit;
  readonly massLeike: number;
  readonly akLeike: number;
  /** Table 3's Leike-resolution peak A_K as A_V, the column n0Cal is solved for. */
  readonly avColumnTarget: number;
  readonly calibration: Calibration;
}

/** Corona Australis has a box but no Table 2 or 3 row, so it is not profiled. */
export function profiledClouds(
  extents: readonly Z2021Extent[],
  fits: ReadonlyMap<string, PlummerFit>,
  masses: ReadonlyMap<string, Z2021Mass>,
): ProfiledCloud[] {
  return extents.flatMap((e) => {
    const fit = fits.get(e.cloud);
    const mass = masses.get(e.cloud);
    if (fit === undefined || mass === undefined) return [];
    const { centreGal, axesGal } = extentGeometry(e);
    const avColumnTarget = mass.maxAkLeike / AK_OVER_AV;
    return [{
      rawName: e.cloud,
      centreIcrsPc: galToIcrs(centreGal),
      axesGalPc: axesGal,
      fit,
      massLeike: mass.massLeike,
      akLeike: mass.maxAkLeike,
      avColumnTarget,
      calibration: calibrate(fit, axesGal, avColumnTarget, mass.massLeike),
    }];
  });
}
