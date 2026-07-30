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

/** Soft half-width (planet-radius units) of the planetary shadow terminator in
 *  the atmosphere. A hard lit/unlit test quantises the multiscatter lit-fraction
 *  and the single-scatter terminator into visible contours across the terminator
 *  (moiré under the few-sample march); smoothing over this band keeps both
 *  continuous. */
export const SHADOW_SOFT = 0.15;

/** Isotropic multiple-scattering fill weight. Single scattering alone leaves
 *  optically thick hazes (Venus, Titan) far too dark — most of their light
 *  is multiply scattered. This adds a cheap ambient term = scatter-fraction ×
 *  opacity × sunlit, which is negligible for thin atmospheres (Earth) and
 *  dominant for thick ones. */
export const MS_STRENGTH = 0.2;

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

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Fraction of the point (px,py,pz) lit by the sun: 1 unless it is BOTH
 *  anti-sunward of the terminator plane AND inside the planet's shadow
 *  cylinder, smoothed over SHADOW_SOFT. Mirrors stellata_sunLit in the GLSL. */
export function sunLit(px: number, py: number, pz: number, sx: number, sy: number, sz: number): number {
  const sunT = px * sx + py * sy + pz * sz;
  const impact = Math.sqrt(Math.max(px * px + py * py + pz * pz - sunT * sunT, 0));
  return Math.max(
    smoothstep(0, SHADOW_SOFT, sunT),
    smoothstep(1 - SHADOW_SOFT, 1 + SHADOW_SOFT, impact),
  );
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

    const lit = sunLit(px, py, pz, sunDir[0], sunDir[1], sunDir[2]);
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
