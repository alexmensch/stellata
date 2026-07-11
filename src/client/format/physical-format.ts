// Physical-quantity display formatting shared by the hover and focus
// cards — radii, extents, magnitudes, coarse provenance. See ./README.md.

import { fmtDist } from '../ui/distance-util';

/** Mean Earth radius, km (IUGG). Planet radii display in Earth radii. */
export const EARTH_RADIUS_KM = 6371;

/** Camera distances closer than the |appMag − absMag| ≤ this band render
 *  the apparent-magnitude value as "—" — the value would only duplicate
 *  the absolute magnitude on the card. */
export const APP_MAG_GATE = 0.1;

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

/** Display value for the camera-frame apparent-magnitude row. "—" when
 *  the value is within APP_MAG_GATE of the absolute magnitude (it would
 *  only restate the Abs mag row) or when the distance is degenerate. */
export function appMagCameraDisplay(absmag: number, dCameraPc: number): string {
  if (!Number.isFinite(dCameraPc) || dCameraPc <= 0) return '—';
  const appMag = apparentMagFromCamera(absmag, dCameraPc);
  if (!Number.isFinite(appMag) || Math.abs(appMag - absmag) <= APP_MAG_GATE) return '—';
  return formatMagnitude(appMag);
}

/** Coarse source-catalog provenance inferred from which identity fields
 *  are populated — "Known from: Gaia DR3 · Hipparcos · HD". Rich
 *  per-field provenance is a tier-3 concern. */
export function coarseProvenance(ids: {
  gaiaSourceId?: bigint;
  hip?: number;
  hd?: number;
}): string[] {
  const out: string[] = [];
  if (ids.gaiaSourceId !== undefined && ids.gaiaSourceId !== 0n) out.push('Gaia DR3');
  if (ids.hip !== undefined && ids.hip > 0) out.push('Hipparcos');
  if (ids.hd !== undefined) out.push('HD');
  return out;
}
