// Physical-quantity display formatting shared by the hover and focus
// cards — radii, extents, magnitudes, coarse provenance. See ./README.md.

import { fmtDist } from '../ui/distance-util';

/** Mean Earth radius, km (IUGG). Planet radii display in Earth radii. */
export const EARTH_RADIUS_KM = 6371;

/** Thousands-separated integer. Deterministic across locales
 *  (`toLocaleString` varies between environments and breaks golden tests
 *  on a German vitest runner that would render Jupiter as "69.911 km"). */
export function formatThousands(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatKm(km: number): string {
  return formatThousands(km);
}

/** Effective temperature: "9,602 K". */
export function formatKelvin(teff: number): string {
  return `${formatThousands(teff)} K`;
}

/** Stellar radius in solar radii — catalog `physicalRadius` is already
 *  in R☉. Precision widens as the value shrinks so white dwarfs
 *  (~0.01 R☉) stay meaningful. */
export function formatSolarRadii(rSun: number): string {
  const v = rSun >= 10 ? rSun.toFixed(0) : rSun >= 1 ? rSun.toFixed(1) : rSun.toFixed(2);
  return `${v} R☉`;
}

/** Planet radius in Earth radii with the km figure retained in parens:
 *  "11.0 R⊕ (69,911 km)". */
export function formatEarthRadii(radiusKm: number): string {
  const re = radiusKm / EARTH_RADIUS_KM;
  const v = re >= 10 ? re.toFixed(1) : re.toFixed(2);
  return `${v} R⊕ (${formatKm(radiusKm)} km)`;
}

/**
 * Render a major × minor axis pair as "<major> × <minor> <unit>". Both
 * values run through `fmtDist` so the user-selected pc/ly unit and the
 * decade-tier prefix (k, M) apply; the major's trailing " pc" / " ly"
 * is stripped so the unit suffix appears once at the end. Local Group
 * semi-axes (~50 pc — ~30 kpc) and cloud semi-axes (~5 pc — ~90 pc)
 * both land in the same `fmtDist` decade tier in practice, so the
 * single suffix reads consistently.
 */
export function formatAxisPair(majorPc: number, minorPc: number): string {
  const minor = fmtDist(minorPc);
  const major = fmtDist(majorPc).replace(/\s+(pc|ly)$/, '');
  return `${major} × ${minor}`;
}

/** Apparent V magnitude at the camera's vantage: absmag + 5·log10(d) − 5. */
export function apparentMagFromCamera(absmag: number, dCameraPc: number): number {
  return absmag + 5 * Math.log10(dCameraPc) - 5;
}

/** Magnitude with an explicit sign so brightness reads at a glance
 *  (negative = naked-eye bright). One decimal. */
export function formatMagnitude(m: number): string {
  return m >= 0 ? `+${m.toFixed(1)}` : m.toFixed(1);
}

/** Display value for the camera-frame apparent-magnitude row. "—" only
 *  when the distance is degenerate (zero / non-finite). */
export function appMagCameraDisplay(absmag: number, dCameraPc: number): string {
  if (!Number.isFinite(dCameraPc) || dCameraPc <= 0) return '—';
  const appMag = apparentMagFromCamera(absmag, dCameraPc);
  if (!Number.isFinite(appMag)) return '—';
  return formatMagnitude(appMag);
}

/** Orbital-period readout in years. Sub-decade values keep two decimals
 *  (Mercury 0.24, Earth 1.00); double-digit-plus drop to whole years
 *  (Jupiter 12, Pluto 248) where the fractional part is noise. */
export function formatPeriodYears(yr: number): string {
  return yr >= 10 ? yr.toFixed(0) : yr.toFixed(2);
}

/** Orbital-period readout in days — the moon-scale counterpart of
 *  `formatPeriodYears` (a year is meaningless for a body orbiting in days).
 *  Same decade split: Io 1.77, Iapetus 79. */
export function formatPeriodDays(d: number): string {
  return d >= 10 ? d.toFixed(0) : d.toFixed(2);
}

/** Planet orbital period in years from the semi-major axis — Kepler's
 *  third law in the Sun-mass system: T(yr) = a(AU)^1.5. For exoplanets
 *  the host-mass term reappears as T = a^1.5/√M; until then every
 *  attached host is Sol-mass so the simple form is exact. */
export function planetPeriodYears(semiMajorAxisAu: number): number {
  return Math.pow(semiMajorAxisAu, 1.5);
}

/** "Period 332d · Δmag 7.6" for a GCVS-matched variable; null when the
 *  record carries no period/amplitude (not variable). */
export function formatVariability(periodDays: number, amplitudeMag: number): string | null {
  if (!(periodDays > 0) || !(amplitudeMag > 0)) return null;
  const periodStr =
    periodDays >= 10 ? `${periodDays.toFixed(0)}d` : `${periodDays.toFixed(2)}d`;
  return `Period ${periodStr} · Δmag ${amplitudeMag.toFixed(1)}`;
}

/** Coarse source-catalog provenance inferred from which identity fields
 *  are populated — "Known from: Gaia DR3 · Hipparcos · HD". A synthetic
 *  promoted companion carries no ids by construction — its record was
 *  minted from a WDS measurement, so that IS its provenance. A real
 *  catalog row with no ids at all is an AT-HYG Tycho-2-only star. Rich
 *  per-field provenance is a tier-3 concern. */
export function coarseProvenance(ids: {
  gaiaSourceId?: bigint;
  hip?: number;
  hd?: number;
  gl?: string;
  syntheticCompanion?: boolean;
}): string[] {
  if (ids.syntheticCompanion) return ['WDS'];
  const out: string[] = [];
  if (ids.gaiaSourceId !== undefined && ids.gaiaSourceId !== 0n) out.push('Gaia DR3');
  if (ids.hip !== undefined && ids.hip > 0) out.push('Hipparcos');
  if (ids.hd !== undefined) out.push('HD');
  if (ids.gl) out.push('Gliese');
  return out.length > 0 ? out : ['Tycho-2'];
}
