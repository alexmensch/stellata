// Single-scattering atmosphere model (Nishita/O'Neil few-sample) — the CPU
// mirror of atmosphere-scatter.glsl. Geometry in planet-radius units, planet
// centred at origin. Model + calibration: README.md § Atmospheres.

export const ATMO_N_VIEW = 16;
export const ATMO_N_LIGHT = 10;
export const MIE_G_DEFAULT = 0.76;

/** Golden-ratio increment used to decorrelate the light-march jitter from the
 *  view-march (and per view-sample), so the two ray-march lattices don't beat
 *  into a moiré — the residual reads as unstructured grain instead. */
const LIGHT_JITTER_STRIDE = 0.6180339887;

/** Isotropic multiple-scattering fill weight. Single scattering alone leaves
 *  optically thick hazes (Venus, Titan) far too dark — most of their light
 *  is multiply scattered. This adds a cheap ambient term = scatter-fraction ×
 *  opacity × sunlit.
 *
 *  0.0667 is 0.2/3, and the /3 is load-bearing: the 0.2 was judged by eye
 *  while single scatter still carried a 3× gain, so carrying it unchanged
 *  past that gain's deletion would triple this term's share of the airlight
 *  and grey out the surface texture the weight exists to stay under.
 *  README.md § Multiple-scattering fill has the shares. */
export const MS_STRENGTH = 0.0667;

/** Sol illuminant colour (warm white). Non-Sol hosts (bk5) will override. */
export const SUN_COLOUR: readonly [number, number, number] = [1.0, 0.98, 0.94];

const RAYLEIGH_PHASE_K = 3 / (16 * Math.PI);
const INV_4PI = 1 / (4 * Math.PI);

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
 * needs its own occlusion test.
 *
 * Solving the shadow beats sampling it: a point-per-segment lit/unlit test
 * quantises the lit sample count into `ATMO_N_VIEW` brightness contours
 * across the terminator, and the fixed 0.15-radius smoothing that used to
 * hide them was 956 km on Earth — sunlight in the densest layers 32° past
 * the terminator, an airglow arc tens of degrees wide. Mirrors
 * stellata_shadowSpan in the GLSL.
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
 * Both bounds are taken as **offsets from t**, and that is load-bearing rather
 * than tidy: `t` is the ray parameter measured from the camera, so `t ± h` are
 * large and nearly equal, and `1/(2h)` amplifies whatever their float32
 * difference loses — full-strength sunlight speckling the anti-solar face,
 * patterned by the march jitter. Clamping to the segment first makes a segment
 * wholly inside or outside the shadow return exactly 0 or 1.
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

/** Share of the host's perpendicular irradiance that a unit vertical
 *  scattering optical depth delivers to the ground as skylight: ¼ from the
 *  hemispheric average of an isotropic in-scatter, times the ≈0.22 slant
 *  transmission a horizon sun reaches the scattering column through.
 *  Calibrated on Earth at the geometric terminator, where twilight measures
 *  ~400 lx against full sun's ~100 klx. */
export const TWILIGHT_SCATTER_FRAC = 0.055;

/** Twilight: the fraction of host irradiance the lit atmosphere scatters
 *  down onto the surface below it, per channel. Its angular reach is the
 *  body's own scale height — the shadow edge climbing out of the scattering
 *  column is what extinguishes it, a few degrees on Earth and ~10° on
 *  Titan. Mirrors stellata_twilightIrradiance in the GLSL. */
export function twilightIrradianceFrac(sunCos: number, hR: number, tauScatter: Vec3): Vec3 {
  const f = TWILIGHT_SCATTER_FRAC * Math.exp(-shadowEdgeAltitude(sunCos) / hR);
  return [tauScatter[0] * f, tauScatter[1] * f, tauScatter[2] * f];
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

export interface ScatterResult {
  /** In-scattered airlight per channel, as a fraction of the host's
   *  perpendicular irradiance — `∫β_s·P·T dl` is already dimensionless, so
   *  the caller's `uAirlightLuminance` is the whole of the scale and there
   *  is no gain to apply. */
  readonly inscatter: Vec3;
  /** View-path transmittance per channel — multiplies the surface behind. */
  readonly transmittance: Vec3;
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
    return { inscatter: [0, 0, 0], transmittance: [1, 1, 1] };
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
  const litFrac = litSum / ATMO_N_VIEW;
  for (let c = 0; c < 3; c++) {
    transmittance[c] = Math.exp(-(p.betaRs[c] * viewOdR + (p.betaMs + p.betaA[c]) * viewOdM));
    // Isotropic multiple-scattering fill: fraction-scattered × opacity ×
    // sunlit. Negligible when thin (opacity → 0), dominant when thick.
    const scatterC = p.betaRs[c] + p.betaMs;
    const ssAlbedo = scatterC / Math.max(scatterC + p.betaA[c], 1e-6);
    const ms = ssAlbedo * (1 - transmittance[c]) * litFrac * MS_STRENGTH;
    inscatter[c] += ms;
  }
  return { inscatter, transmittance };
}
