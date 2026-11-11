// How the orbit catalogues' periastron epochs read as a JD: the offsets, the plausible window, the year-else-truncated-JD reading.

import { jdOfJulianYear } from '../../src/astro-core/precession';

/** The value stored is JD − 2,400,000. */
export const TRUNCATED_JD_TO_JD_OFFSET = 2400000.0;
export const MJD_TO_JD_OFFSET = 2400000.5;

/** A fitted periastron epoch outside 1700-2600 is a misread unit. */
export const T0_MIN_PLAUSIBLE_JD = jdOfJulianYear(1700.0);
export const T0_MAX_PLAUSIBLE_JD = jdOfJulianYear(2600.0);

export function isPlausibleT0Jd(jd: number): boolean {
  return T0_MIN_PLAUSIBLE_JD <= jd && jd <= T0_MAX_PLAUSIBLE_JD;
}

/** The truncated-JD reading of `t0` when plausible, else null. */
export function plausibleTruncatedJd(t0: number): number | null {
  const jd = t0 + TRUNCATED_JD_TO_JD_OFFSET;
  return isPlausibleT0Jd(jd) ? jd : null;
}

/** The year reading of `t0` (README.md#year-form-epochs) when plausible, else
 *  its plausible truncated-JD reading, else null. */
export function yearElseTruncatedJd(t0: number): number | null {
  const yearJd = jdOfJulianYear(t0);
  return isPlausibleT0Jd(yearJd) ? yearJd : plausibleTruncatedJd(t0);
}
