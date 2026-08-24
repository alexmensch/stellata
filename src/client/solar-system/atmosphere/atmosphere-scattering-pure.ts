// Single-scattering atmosphere model (Nishita/O'Neil few-sample) — the CPU
// mirror of atmosphere-scatter.glsl. Geometry in planet-radius units, planet
// centred at origin. Model + calibration: README.md § Atmospheres.

import { relativeLuminance } from '../../hdr/tonemap-pure';
import type { PlanetAtmosphere } from '../planet-system';

export const ATMO_N_VIEW = 16;
export const ATMO_N_LIGHT = 10;
export const MIE_G_DEFAULT = 0.76;

/** Golden-ratio increment used to decorrelate the light-march jitter from the
 *  view-march (and per view-sample), so the two ray-march lattices don't beat
 *  into a moiré — the residual reads as unstructured grain instead. */
export const LIGHT_JITTER_STRIDE = 0.6180339887;

/** Interleaved-gradient-noise constants — the per-fragment [0,1) hash that
 *  offsets the sample lattice so the few-sample march reads as fine grain
 *  instead of a fixed moiré. Both shader backends read these. */
export const ATMO_JITTER_COEFFS: readonly [number, number] = [0.06711056, 0.00583715];
export const ATMO_JITTER_SCALE = 52.9829189;

const RAYLEIGH_PHASE_K = 3 / (16 * Math.PI);
const INV_4PI = 1 / (4 * Math.PI);

/** Isotropic multiple-scattering fill weight — the isotropic source-function
 *  approximation, so it IS 1/(4π): the same redistribution the skylight
 *  terminator anchor's ¼ comes from. Derivation + measured shares:
 *  README.md § Multiple-scattering fill. */
export const MS_STRENGTH = INV_4PI;

/** Sol illuminant colour (warm white). Non-Sol hosts (bk5) will override. */
export const SUN_COLOUR: readonly [number, number, number] = [1.0, 0.98, 0.94];

export type Vec3 = readonly [number, number, number];

/** Rayleigh angular phase: 3/16π·(1 + cos²θ). */
export function rayleighPhase(mu: number): number {
  return RAYLEIGH_PHASE_K * (1 + mu * mu);
}

/** Henyey-Greenstein phase, forward-peaked for g > 0. */
export function miePhase(mu: number, g: number): number {
  const g2 = g * g;
  const denom = Math.max(1 + g2 - 2 * g * mu, 1e-6);
  return (INV_4PI * (1 - g2)) / (denom * Math.sqrt(denom));
}

/** Second (far) positive root of |o + t·d| = radius, or a negative sentinel
 *  when the ray misses. d must be unit; the sphere is centred at the origin. */
function farRoot(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, radius: number): number {
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return -1;
  return -b + Math.sqrt(disc);
}

/**
 * Scale a vector's component along `pole` by `s`, leaving the equatorial part
 * untouched. Mirrors stellata_scalePolar in the GLSL.
 *
 * This is the seam between an oblate body and a march that assumes a unit
 * sphere. `s = 1/polarR` maps a spheroid of polar radius `polarR` (equatorial
 * radii) onto the unit sphere; `s = polarR` is the inverse. The map is linear
 * about the body centre, so a ray maps to a ray with its parameter unchanged —
 * callers renormalise directions and are otherwise unaffected. A surface
 * *normal* scales by the inverse transpose, which for this diagonal map is the
 * inverse: squashing an ellipsoid normal by `polarR` and renormalising gives
 * the unit-sphere point the fragment corresponds to.
 */
export function scalePolarComponent(v: Vec3, pole: Vec3, s: number): Vec3 {
  const along = (v[0] * pole[0] + v[1] * pole[1] + v[2] * pole[2]) * (s - 1);
  return [v[0] + pole[0] * along, v[1] + pole[1] * along, v[2] + pole[2] * along];
}

const FAR = 1e20;

/** Sentinel span standing for "this ray never enters the shadow": inverted
 *  and unbounded, so it reads as empty against any ray parameter rather than
 *  only against ones outside [1, 0]. */
const NO_SHADOW: readonly [number, number] = [FAR, -FAR];

/**
 * The planetary shadow along `o + t·d`, as the single t-interval `[s0, s1]`
 * it always is: inside the infinite shadow cylinder (a quadratic in t) and
 * anti-sunward of the terminator plane (a half-space). `s0 > s1` when the
 * ray never enters it. Equivalent to asking whether the ray from each point
 * toward the host strikes the body, which is why the light march below never
 * needs its own occlusion test. Mirrors stellata_shadowSpan in the GLSL.
 */
export function shadowSpan(o: Vec3, d: Vec3, sunDir: Vec3): readonly [number, number] {
  const oS = o[0] * sunDir[0] + o[1] * sunDir[1] + o[2] * sunDir[2];
  const dS = d[0] * sunDir[0] + d[1] * sunDir[1] + d[2] * sunDir[2];
  const oP: Vec3 = [o[0] - oS * sunDir[0], o[1] - oS * sunDir[1], o[2] - oS * sunDir[2]];
  const dP: Vec3 = [d[0] - dS * sunDir[0], d[1] - dS * sunDir[1], d[2] - dS * sunDir[2]];
  const a = dP[0] * dP[0] + dP[1] * dP[1] + dP[2] * dP[2];
  const b = oP[0] * dP[0] + oP[1] * dP[1] + oP[2] * dP[2];
  const c = oP[0] * oP[0] + oP[1] * oP[1] + oP[2] * oP[2] - 1;

  let lo: number;
  let hi: number;
  if (a > 1e-12) {
    const disc = b * b - a * c;
    if (disc <= 0) return NO_SHADOW;
    const r = Math.sqrt(disc);
    lo = (-b - r) / a;
    hi = (-b + r) / a;
  } else {
    // Ray parallel to the shadow axis: its impact parameter never changes.
    if (c >= 0) return NO_SHADOW;
    lo = -FAR;
    hi = FAR;
  }

  if (Math.abs(dS) > 1e-12) {
    const th = -oS / dS;
    if (dS > 0) hi = Math.min(hi, th);
    else lo = Math.max(lo, th);
  } else if (oS >= 0) {
    return NO_SHADOW;
  }
  return [lo, hi];
}

/**
 * Fraction of the march segment centred on `t` with half-width `h` that falls
 * outside the shadow span — the exact quadrature weight for a hard shadow, and
 * continuous in the ray's geometry, so the lit sample count cannot step.
 * Mirrors stellata_litFraction in the GLSL.
 *
 * Both bounds MUST stay **offsets from `t`**. `t` is the ray parameter measured
 * from the camera, so `t ± h` are large and nearly equal and the `1/(2h)`
 * amplifies whatever float32 loses between them; clamping to the segment first
 * is what makes a segment wholly inside or outside the shadow return exactly
 * 0 or 1.
 */
export function litFraction(t: number, h: number, span: readonly [number, number]): number {
  const lo = Math.max(span[0] - t, -h);
  const hi = Math.min(span[1] - t, h);
  return 1 - Math.max(hi - lo, 0) / (2 * h);
}

/** Altitude (planet-radius units) of the planetary shadow's upper edge
 *  directly above a surface point whose sun-cosine is `sunCos`: 0 on the lit
 *  side, `1/cos(Δ) − 1` for a point Δ past the geometric terminator. Only the
 *  column above it still sees the host, so this is the depth the ground's
 *  twilight illumination has to reach out of. */
export function shadowEdgeAltitude(sunCos: number): number {
  if (sunCos >= 0) return 0;
  return 1 / Math.sqrt(Math.max(1 - sunCos * sunCos, 1e-12)) - 1;
}

/** Vertical scattering optical depth per channel — Rayleigh plus grey Mie,
 *  each coefficient over its own scale height. Absorption is excluded: this
 *  is what redirects light, not what removes it. */
export function verticalScatterOpticalDepth(p: AtmosphereParams): Vec3 {
  const mie = p.betaMs * p.hM;
  return [p.betaRs[0] * p.hR + mie, p.betaRs[1] * p.hR + mie, p.betaRs[2] * p.hR + mie];
}

/** Vertical absorption optical depth per channel — the aerosol absorption
 *  coefficient over its own (Mie) scale height. */
export function verticalAbsorptionOpticalDepth(p: AtmosphereParams): Vec3 {
  return [p.betaA[0] * p.hM, p.betaA[1] * p.hM, p.betaA[2] * p.hM];
}

/** Chapman airmass of a horizon sun for an exponential atmosphere of scale
 *  height `hR` (planet-radius units): √(π/(2·hR)) — ~35 on Earth. Inlined as
 *  the same expression in the GLSL mirror, which the drift test pins. */
function chapmanHorizon(hR: number): number {
  return Math.sqrt(Math.PI / (2 * hR));
}

/** Multiple-scattering twilight tail: relative amplitude and reach (in
 *  Rayleigh scale heights) of the second exponential, fit through the
 *  measured Earth horizontal illuminance at 12° and 18° of solar depression
 *  (0.008 lx and 0.0006 lx against ~400 lx at the geometric terminator).
 *  The pure test re-derives both from that table. */
export const TWILIGHT_TAIL_AMP = 1.459e-4;
export const TWILIGHT_TAIL_REACH = 8.95;

/**
 * Skylight: the fraction of host irradiance the atmosphere scatters down
 * onto the surface, per channel — one derived model covering the lit
 * hemisphere and the twilight band. Mirrors stellata_skyIrradiance in the
 * GLSL; derivation and measured anchors: README.md § Skylight.
 *
 * The horizon-sun anchor and the beam term describe the same photons at
 * opposite solar elevations, so they partition as `(1 − μ_s)` / `μ_s` rather
 * than summing — carrying the anchor to noon double-counts it.
 */
export function skyIrradianceFrac(
  sunCos: number,
  hR: number,
  tauScatter: Vec3,
  tauAbsorb: Vec3,
): Vec3 {
  const ch = chapmanHorizon(hR);
  const h = shadowEdgeAltitude(sunCos);
  const tail =
    Math.exp(-h / hR) + TWILIGHT_TAIL_AMP * Math.exp(-h / (TWILIGHT_TAIL_REACH * hR));
  const mu = Math.max(sunCos, 0);
  const muSafe = Math.max(mu, 1e-4);
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const tauExt = Math.max(tauScatter[c] + tauAbsorb[c], 1e-6);
    const x = tauExt * ch;
    const tBar = (1 - Math.exp(-x)) / x;
    const fTerm = 0.25 * tauScatter[c] * tBar * Math.exp(-tauAbsorb[c]);
    const beam =
      0.5 * mu * (tauScatter[c] / tauExt) *
      (1 - Math.exp(-tauExt / muSafe)) * Math.exp(-tauAbsorb[c] / muSafe);
    out[c] = fTerm * tail * (1 - mu) + beam;
  }
  return out;
}

export interface AtmosphereParams {
  /** Atmosphere top radius, R-units (1 + heightKm/radiusKm). */
  readonly rAtmo: number;
  /** Rayleigh / Mie scale heights, R-units. */
  readonly hR: number;
  readonly hM: number;
  /** Rayleigh scatter coefficient per channel (1/λ⁴ shape), 1/R-units. */
  readonly betaRs: Vec3;
  /** Mie scatter coefficient (grey), 1/R-units. */
  readonly betaMs: number;
  /** Aerosol absorption per channel (colour source), 1/R-units. */
  readonly betaA: Vec3;
  /** Henyey-Greenstein asymmetry. */
  readonly g: number;
}

/** March params for one authored per-body row. The table carries **vertical
 *  optical depths**; dividing each by its own scale height is what turns them
 *  into the surface extinction coefficients the integrator marches, and this
 *  is the only place that conversion happens. */
export function atmosphereParamsOf(
  atmo: PlanetAtmosphere,
  radiusKm: number,
): AtmosphereParams {
  const hR = atmo.rayleighHeightKm / radiusKm;
  const hM = atmo.mieHeightKm / radiusKm;
  return {
    rAtmo: (radiusKm + atmo.heightKm) / radiusKm,
    hR,
    hM,
    betaRs: [
      atmo.rayleighCoeff[0] / hR,
      atmo.rayleighCoeff[1] / hR,
      atmo.rayleighCoeff[2] / hR,
    ],
    betaMs: atmo.mieCoeff / hM,
    betaA: [
      atmo.absorbCoeff[0] / hM,
      atmo.absorbCoeff[1] / hM,
      atmo.absorbCoeff[2] / hM,
    ],
    g: atmo.mieG ?? MIE_G_DEFAULT,
  };
}

export interface ScatterResult {
  /** In-scattered airlight per channel, as a fraction of the host's
   *  perpendicular irradiance — `∫β_s·P·T dl` is already dimensionless, so
   *  the caller's `uAirlightLuminance` is the whole of the scale and there
   *  is no gain to apply. Single scatter plus `msFill`. */
  readonly inscatter: Vec3;
  /** View-path transmittance per channel — multiplies the surface behind. */
  readonly transmittance: Vec3;
  /** The isotropic multiple-scattering fill's own contribution to
   *  `inscatter`. Broken out on the CPU side only (the shader has no use
   *  for it) so its share can be measured instead of re-derived — it is
   *  the majority of the airlight at physical depths, which is the thing
   *  to watch: README.md § Multiple-scattering fill. */
  readonly msFill: Vec3;
}

/** Integrate single-scattered airlight (+ a cheap multiple-scattering fill)
 *  and view-path transmittance along the ray o + t·d for t ∈ [tStart, tStop]
 *  (planet centred at origin, rPlanet = 1). Mirrors stellata_atmosphereRadiance
 *  in atmosphere-scatter.glsl. `jitter` ∈ [0,1) offsets the sample lattice
 *  within each segment — the shader passes a per-fragment value to break
 *  ray-march banding; the CPU mirror uses the midpoint (0.5). */
export function scatterAlongRay(
  o: Vec3,
  d: Vec3,
  tStart: number,
  tStop: number,
  sunDir: Vec3,
  p: AtmosphereParams,
  jitter = 0.5,
): ScatterResult {
  const span = tStop - tStart;
  if (span <= 0) {
    return { inscatter: [0, 0, 0], transmittance: [1, 1, 1], msFill: [0, 0, 0] };
  }
  const segLen = span / ATMO_N_VIEW;
  const shadow = shadowSpan(o, d, sunDir);
  const mu = d[0] * sunDir[0] + d[1] * sunDir[1] + d[2] * sunDir[2];
  const pR = rayleighPhase(mu);
  const pM = miePhase(mu, p.g);

  let viewOdR = 0;
  let viewOdM = 0;
  let litSum = 0;
  const inscatter: [number, number, number] = [0, 0, 0];

  for (let i = 0; i < ATMO_N_VIEW; i++) {
    const t = tStart + (i + jitter) * segLen;
    const px = o[0] + t * d[0];
    const py = o[1] + t * d[1];
    const pz = o[2] + t * d[2];
    const h = Math.max(Math.sqrt(px * px + py * py + pz * pz) - 1, 0);
    const dR = Math.exp(-h / p.hR);
    const dM = Math.exp(-h / p.hM);
    viewOdR += dR * segLen;
    viewOdM += dM * segLen;

    const lit = litFraction(t, 0.5 * segLen, shadow);
    litSum += lit;
    if (lit <= 0) continue;
    const sExit = farRoot(px, py, pz, sunDir[0], sunDir[1], sunDir[2], p.rAtmo);
    if (sExit <= 0) continue;

    // Decorrelate the light-march offset from the view-march (and per view
    // sample) so the two lattices don't beat into a moiré.
    const lightJit = (jitter + i * LIGHT_JITTER_STRIDE) % 1;
    const lStep = sExit / ATMO_N_LIGHT;
    let lightOdR = 0;
    let lightOdM = 0;
    for (let j = 0; j < ATMO_N_LIGHT; j++) {
      const s = (j + lightJit) * lStep;
      const qx = px + s * sunDir[0];
      const qy = py + s * sunDir[1];
      const qz = pz + s * sunDir[2];
      const hq = Math.max(Math.sqrt(qx * qx + qy * qy + qz * qz) - 1, 0);
      lightOdR += Math.exp(-hq / p.hR) * lStep;
      lightOdM += Math.exp(-hq / p.hM) * lStep;
    }

    for (let c = 0; c < 3; c++) {
      const tau = p.betaRs[c] * (viewOdR + lightOdR) + (p.betaMs + p.betaA[c]) * (viewOdM + lightOdM);
      const attn = Math.exp(-tau);
      const scatter = p.betaRs[c] * dR * pR + p.betaMs * dM * pM;
      inscatter[c] += scatter * attn * segLen * lit;
    }
  }

  const transmittance: [number, number, number] = [0, 0, 0];
  const msFill: [number, number, number] = [0, 0, 0];
  const litFrac = litSum / ATMO_N_VIEW;
  for (let c = 0; c < 3; c++) {
    transmittance[c] = Math.exp(-(p.betaRs[c] * viewOdR + (p.betaMs + p.betaA[c]) * viewOdM));
    // Isotropic multiple-scattering fill: fraction-scattered × opacity ×
    // sunlit. Negligible when thin (opacity → 0), dominant when thick.
    const scatterC = p.betaRs[c] + p.betaMs;
    const ssAlbedo = scatterC / Math.max(scatterC + p.betaA[c], 1e-6);
    msFill[c] = ssAlbedo * (1 - transmittance[c]) * litFrac * MS_STRENGTH;
    inscatter[c] += msFill[c];
  }
  return { inscatter, transmittance, msFill };
}

/** Full-phase disc means (luma) of everything the mesh shader lays over the
 *  body's flux — the normalisers that keep the drawn disc integrating to the
 *  body's true flux. README.md § Flux bookkeeping. */
export interface AtmoDiscMeans {
  /** ⟨μ · luma(T_view)⟩ — the Lambert disc mean of what survives the view
   *  path. The airless 2/3 in the transparent limit, and *less* than that
   *  whenever the column extincts: the atmosphere dims the ground it lights. */
  readonly surface: number;
  /** ⟨luma(E_sky) · luma(T_view)⟩ — skylight reflected off the ground, out
   *  through the same column. Rides the same scalar as `surface`. */
  readonly sky: number;
  /** ⟨luma(inscatter)⟩ · luma(illuminant) — the airlight in front of the
   *  disc, as a fraction of host irradiance and carrying no albedo, so the
   *  caller scales it by π/p to compare against the body's own flux. */
  readonly airlight: number;
}

const DISC_MEAN_N = 64;

/**
 * Measure the disc means through the same march the shader runs, at full
 * phase — where a disc point's sun cosine equals its emission cosine μ and
 * the area weight is 2μ dμ. `illuminantLuma` is luma(uSunColour): the
 * airlight rides the illuminant, the surface does not.
 *
 * Orthographic-limit geometry, as `lambertLimbDiscMean` also assumes: the
 * view ray drops from the shell top onto the surface point along the
 * sun-facing axis. Converged to 5 digits by `DISC_MEAN_N`.
 */
export function atmoDiscMeans(p: AtmosphereParams, illuminantLuma = 1): AtmoDiscMeans {
  const tauScatter = verticalScatterOpticalDepth(p);
  const tauAbsorb = verticalAbsorptionOpticalDepth(p);
  const sunDir: Vec3 = [0, 0, 1];
  const dir: Vec3 = [0, 0, -1];
  let surface = 0;
  let sky = 0;
  let airlight = 0;
  for (let i = 0; i < DISC_MEAN_N; i++) {
    const mu = (i + 0.5) / DISC_MEAN_N;
    const off = Math.sqrt(Math.max(1 - mu * mu, 0));
    const zTop = Math.sqrt(Math.max(p.rAtmo * p.rAtmo - off * off, 0));
    const march = scatterAlongRay([off, 0, zTop], dir, 0, zTop - mu, sunDir, p);
    const tView = relativeLuminance(march.transmittance);
    const weight = (2 * mu) / DISC_MEAN_N;
    surface += mu * tView * weight;
    sky += relativeLuminance(skyIrradianceFrac(mu, p.hR, tauScatter, tauAbsorb)) * tView * weight;
    airlight += relativeLuminance(march.inscatter) * weight;
  }
  return { surface, sky, airlight: airlight * illuminantLuma };
}
