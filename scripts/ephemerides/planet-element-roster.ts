// The nine element tables to fetch: Horizons target, sample cadence, and the
// window every table spans. Authoring source for data/ephemerides/; editing a
// cadence needs a re-run of `fetch:ephemerides`.

import { DAYS_PER_JULIAN_YEAR, J2000_JD } from '../../src/client/util/astronomy-constants';
import type { PlanetName } from '../../src/client/solar-system/ephemerides/ephemeris';

const jdOfJulianYear = (year: number): number =>
  J2000_JD + (year - 2000) * DAYS_PER_JULIAN_YEAR;

/** The observationally meaningful window. Outside it the runtime falls back to
 *  the Standish series, which is within its published budget there and needs
 *  ~30× the data to table. */
export const TABLE_JD_START = jdOfJulianYear(1900);
export const TABLE_JD_END = jdOfJulianYear(2100);

/** The bound each cadence is chosen to hold — the same 1e-5 AU the probe
 *  trajectory grids hold, so a rendered flyby's error is the encounter
 *  geometry's own rather than either dataset's. */
export const POSITION_TOLERANCE_AU = 1e-5;

export interface PlanetElementTarget {
  id: PlanetName;
  /** Horizons **barycentre** id. Standish's series fits the barycentric
   *  orbits, `earth` is the Earth/Moon barycentre `earthMoonSplit` divides,
   *  and a Pluto barycentre skips the 6.4 d Pluto–Charon wobble. */
  horizonsId: string;
  /** Uniform sample spacing, days. Every value divides the window exactly, so
   *  the last sample lands on `TABLE_JD_END` rather than past it. Measured
   *  per planet by `fetch:ephemerides`' off-grid verification pass — see
   *  README.md § Cadence. */
  stepDays: number;
}

export const ELEMENT_TARGETS: readonly PlanetElementTarget[] = [
  { id: 'mercury', horizonsId: '1', stepDays: 50 },
  { id: 'venus', horizonsId: '2', stepDays: 30 },
  { id: 'earth', horizonsId: '3', stepDays: 30 },
  { id: 'mars', horizonsId: '4', stepDays: 30 },
  { id: 'jupiter', horizonsId: '5', stepDays: 50 },
  { id: 'saturn', horizonsId: '6', stepDays: 50 },
  { id: 'uranus', horizonsId: '7', stepDays: 50 },
  { id: 'neptune', horizonsId: '8', stepDays: 50 },
  { id: 'pluto', horizonsId: '9', stepDays: 50 },
];

/** Grid epochs of one target's table. Throws when the cadence does not divide
 *  the window: a truncated last interval would leave the runtime falling back
 *  to Standish inside the window it claims to cover. */
export function tableEpochs(stepDays: number): number[] {
  const span = TABLE_JD_END - TABLE_JD_START;
  const intervals = span / stepDays;
  if (!Number.isInteger(intervals)) {
    throw new Error(`step ${stepDays} d does not divide the ${span} d window`);
  }
  return Array.from({ length: intervals + 1 }, (_, i) => TABLE_JD_START + i * stepDays);
}
