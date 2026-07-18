// Parent/orbit descriptor for the focus card: every body's breadcrumb,
// orbit distance, and period derived from its parent (planet ← host star;
// moon ← parent planet), with no solar-mass assumption. See README.md § Moons.

import { AU_KM } from '../util/astronomy-constants';
import {
  formatKm,
  formatPeriodDays,
  formatPeriodYears,
  planetPeriodYears,
} from '../format/physical-format';
import type { Planet, PlanetSystem } from './planet-system';

export interface OrbitDescriptor {
  // Parent body's display name — the host star for a planet ("Sol"), the
  // parent planet for a moon ("Jupiter"). Null when a planet's host star
  // has no display name, in which case the card omits the breadcrumb.
  readonly parentName: string | null;
  readonly semiMajorAxis: number;
  readonly axisUnit: 'AU' | 'km';
  readonly period: number;
  readonly periodUnit: 'yr' | 'd';
}

const SECONDS_PER_DAY = 86400;
const TWO_PI = Math.PI * 2;

/** Sidereal orbital period in days from a parent-relative semi-major axis
 *  (km) and the parent's standard gravitational parameter GM (km³/s²) —
 *  Kepler III, T = 2π·√(a³/GM). */
export function keplerPeriodDays(semiMajorAxisKm: number, gravParamGM: number): number {
  const a = semiMajorAxisKm;
  return (TWO_PI * Math.sqrt((a * a * a) / gravParamGM)) / SECONDS_PER_DAY;
}

/** Orbit descriptor for a body at flat instance `planet` in `system`. A
 *  planet fills it from its host star + solar-mass period (a^1.5 years, in
 *  AU); a moon from its `parentName` + the parent planet's GM (Kepler-III
 *  period in days, orbit in km). Returns null for a moon whose parent
 *  record is missing or carries no GM — none of the in-scope moons hit
 *  this, but the card degrades to omitting the orbit rows if one did. */
export function orbitDescriptorFor(
  planet: Planet,
  system: PlanetSystem,
  hostName: string | null,
): OrbitDescriptor | null {
  if (planet.parentName) {
    const parent = system.planets.find((p) => p.name === planet.parentName);
    if (!parent || parent.gravParamGM === undefined) return null;
    const aKm = planet.semiMajorAxisAu * AU_KM;
    return {
      parentName: planet.parentName,
      semiMajorAxis: aKm,
      axisUnit: 'km',
      period: keplerPeriodDays(aKm, parent.gravParamGM),
      periodUnit: 'd',
    };
  }
  return {
    parentName: hostName,
    semiMajorAxis: planet.semiMajorAxisAu,
    axisUnit: 'AU',
    period: planetPeriodYears(planet.semiMajorAxisAu),
    periodUnit: 'yr',
  };
}

/** Orbital-period row string for a descriptor. Shared by the hover card
 *  and the focus card so a shared field can't diverge between tiers. */
export function formatOrbitPeriod(d: OrbitDescriptor): string {
  return d.periodUnit === 'd'
    ? `${formatPeriodDays(d.period)} d`
    : `${formatPeriodYears(d.period)} yr`;
}

/** Semi-major-axis row string for a descriptor (AU for a planet, km for
 *  a moon). Focus card only — hover doesn't surface orbit distance. */
export function formatOrbitDistance(d: OrbitDescriptor): string {
  return d.axisUnit === 'km'
    ? `${formatKm(d.semiMajorAxis)} km`
    : `${d.semiMajorAxis.toFixed(d.semiMajorAxis >= 10 ? 1 : 3)} AU`;
}
