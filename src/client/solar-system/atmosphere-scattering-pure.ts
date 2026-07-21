// Single-scattering atmosphere model (Nishita/O'Neil few-sample) — the CPU
// mirror of atmosphere-scatter.glsl. Geometry in planet-radius units, planet
// centred at origin. Model + calibration: README.md § Atmospheres.

export const ATMO_N_VIEW = 12;
export const ATMO_N_LIGHT = 6;
export const MIE_G_DEFAULT = 0.76;

/** Overall single-scatter brightness so the neutral slider (sun = 1) is
 *  roughly calibrated — the airlight is dim in absolute radiance units. */
export const AIRLIGHT_GAIN = 3.0;

/** Isotropic multiple-scattering fill weight. Single scattering alone leaves
 *  optically thick hazes (Venus, Titan) far too dark — most of their light
 *  is multiply scattered. This adds a cheap ambient term = scatter-fraction ×
 *  opacity × sunlit, which is negligible for thin atmospheres (Earth) and
 *  dominant for thick ones. */
export const MS_STRENGTH = 0.6;

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

/** True when the ray o + s·d (s > 0) enters the unit sphere ahead — the
 *  sample sits in the planet's own shadow (night side). */
function inPlanetShadow(px: number, py: number, pz: number, dx: number, dy: number, dz: number): boolean {
  const b = px * dx + py * dy + pz * dz;
  const c = px * px + py * py + pz * pz - 1;
  const disc = b * b - c;
  if (disc < 0) return false;
  return -b - Math.sqrt(disc) > 0;
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
  /** In-scattered airlight radiance per channel (before sun colour). */
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

    if (inPlanetShadow(px, py, pz, sunDir[0], sunDir[1], sunDir[2])) continue;
    const sExit = farRoot(px, py, pz, sunDir[0], sunDir[1], sunDir[2], p.rAtmo);
    if (sExit <= 0) continue;
    litSum++;

    const lStep = sExit / ATMO_N_LIGHT;
    let lightOdR = 0;
    let lightOdM = 0;
    for (let j = 0; j < ATMO_N_LIGHT; j++) {
      const s = (j + jitter) * lStep;
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
      inscatter[c] += scatter * attn * segLen;
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
    inscatter[c] = inscatter[c] * AIRLIGHT_GAIN + ms;
  }
  return { inscatter, transmittance };
}
