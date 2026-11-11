import { describe, expect, it } from 'vitest';

import { jdOfJulianYear } from '../../src/astro-core/precession';
import {
  T0_MAX_PLAUSIBLE_JD, T0_MIN_PLAUSIBLE_JD, TRUNCATED_JD_TO_JD_OFFSET, isPlausibleT0Jd, plausibleTruncatedJd, yearElseTruncatedJd,
} from './epochs-pure';

describe('epoch readings', () => {
  it('bounds the window at 1700 and 2600, inclusive', () => {
    expect([T0_MIN_PLAUSIBLE_JD, T0_MAX_PLAUSIBLE_JD]).toEqual([jdOfJulianYear(1700), jdOfJulianYear(2600)]);
    expect([isPlausibleT0Jd(T0_MIN_PLAUSIBLE_JD), isPlausibleT0Jd(T0_MIN_PLAUSIBLE_JD - 1e-6)]).toEqual([true, false]);
    expect([isPlausibleT0Jd(T0_MAX_PLAUSIBLE_JD), isPlausibleT0Jd(T0_MAX_PLAUSIBLE_JD + 1e-6)]).toEqual([true, false]);
  });

  it('reads a plausible year as one, else a plausible truncated JD, else nothing', () => {
    expect(yearElseTruncatedJd(1990)).toBe(jdOfJulianYear(1990));
    expect(yearElseTruncatedJd(59501.496)).toBe(59501.496 + TRUNCATED_JD_TO_JD_OFFSET);
    expect(yearElseTruncatedJd(300000)).toBeNull();
    expect(plausibleTruncatedJd(40087.19)).toBe(40087.19 + TRUNCATED_JD_TO_JD_OFFSET);
    expect(plausibleTruncatedJd(9.9e7)).toBeNull();
  });
});
