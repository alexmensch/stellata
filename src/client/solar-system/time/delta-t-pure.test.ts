import { describe, it, expect } from 'vitest';
import {
  decimalYearOfJd,
  deltaTSeconds,
  deltaTSecondsAtYear,
  lunarSecularAccelerationCorrection,
} from './delta-t-pure';

// Every interval boundary in the Espenak set. Each side is its own
// polynomial in its own re-centred argument, so a mistyped coefficient or a
// mis-ordered branch shows here as a step and nowhere else.
const BOUNDARIES = [
  -500, 500, 1600, 1700, 1800, 1860, 1900, 1920, 1941, 1961, 1986, 2005,
  2050, 2150,
];

describe('lunarSecularAccelerationCorrection', () => {
  it('vanishes at its own 1955 vertex', () => {
    expect(lunarSecularAccelerationCorrection(1955)).toBeCloseTo(0, 12);
  });

  it('reaches the 202 s the deep-time eclipse ground points turned on', () => {
    // The polynomials assume the Moon's secular acceleration is −26″/cy²;
    // the canons and the ELP/DE ephemerides use −25.858. Left out, ΔT reads
    // this much high at 2000 BC — 0.84° of Earth rotation under every
    // ancient eclipse track.
    expect(lunarSecularAccelerationCorrection(-2000)).toBeCloseTo(-202.28, 2);
  });

  it('is negligible in the modern era, where ΔT is observed rather than fitted', () => {
    expect(Math.abs(lunarSecularAccelerationCorrection(2026))).toBeLessThan(0.1);
  });

  it('only ever subtracts — the sign is what reconciles the two accelerations', () => {
    for (const y of [-2999, -500, 0, 1000, 1955, 2026, 3000]) {
      expect(lunarSecularAccelerationCorrection(y)).toBeLessThanOrEqual(0);
    }
  });
});

describe('deltaTSecondsAtYear', () => {
  it("reproduces the canon's own ΔT at its first total solar eclipse", () => {
    // NASA Five Millennium Canon, −1999 Jun 12: greatest eclipse
    // JD 991085.63500 TT, published as 14:20:53 UT — an implied ΔT of
    // 46438 s. Reproducing it is the whole point of the correction above.
    expect(deltaTSeconds(991085.635)).toBeCloseTo(46438, -1);
  });

  it('reads 20.5 hours at the clock\'s lower bound', () => {
    // 308° of Earth rotation: a fixed offset puts an ancient eclipse track
    // most of a hemisphere from where it belongs. The lunar correction is
    // worth −317 s of this, which is why the figure is not the 20.6 h the
    // bare polynomials give.
    expect(deltaTSecondsAtYear(-2999) / 3600).toBeCloseTo(20.55, 1);
  });

  it('reads ~75 s today — Espenak\'s 2005–2050 segment, extrapolated in 2006', () => {
    // Earth did not slow as projected, so this sits ~6 s above the observed
    // ~69 s. Kept rather than spliced, to hold the function continuous; the
    // cost is bounded in README.md § Timescales.
    expect(deltaTSecondsAtYear(2026)).toBeGreaterThan(69);
    expect(deltaTSecondsAtYear(2026)).toBeLessThan(80);
  });

  it('crosses zero once, in the late 19th century', () => {
    // ΔT really was negative 1871–1902 (Earth spun fast). A regression to a
    // fixed TT−UT constant cannot reproduce a sign change.
    expect(deltaTSecondsAtYear(1885)).toBeLessThan(0);
    expect(deltaTSecondsAtYear(1870)).toBeGreaterThan(0);
    expect(deltaTSecondsAtYear(1910)).toBeGreaterThan(0);
  });

  it('is continuous across every interval boundary', () => {
    for (const y of BOUNDARIES) {
      const step = Math.abs(deltaTSecondsAtYear(y + 1e-6) - deltaTSecondsAtYear(y - 1e-6));
      expect(step, `boundary ${y}`).toBeLessThan(2.5);
    }
  });

  it('falls and rises monotonically on the two long-term-parabola tails', () => {
    // A branch returning the wrong interval's polynomial shows as a local
    // reversal. Only the tails are checked: the 17th–19th centuries
    // genuinely wiggle (ΔT dips to ~8 s at 1700, recovers to ~13 s by 1750)
    // and the fitted segments there reproduce that.
    for (let y = -2900; y < 1500; y += 50) {
      expect(deltaTSecondsAtYear(y), `year ${y}`)
        .toBeGreaterThan(deltaTSecondsAtYear(y + 50));
    }
    for (let y = 2050; y < 2950; y += 50) {
      expect(deltaTSecondsAtYear(y), `year ${y}`)
        .toBeLessThan(deltaTSecondsAtYear(y + 50));
    }
  });
});

describe('decimalYearOfJd', () => {
  it('maps J2000.0 to the year 2000', () => {
    expect(decimalYearOfJd(2451545.0)).toBe(2000);
  });

  it('advances one year per Julian year', () => {
    expect(decimalYearOfJd(2451545.0 + 365.25)).toBeCloseTo(2001, 9);
  });
});

describe('deltaTSeconds', () => {
  it('takes either scale — the function moves under 0.1 s across one ΔT', () => {
    // The docstring's licence to pass a UT or a TT JD interchangeably. It
    // has to hold at the deep end, where ΔT itself is 20 hours wide.
    for (const jd of [625661, 991085.635, 2451545, 2817160]) {
      const ut = deltaTSeconds(jd);
      expect(Math.abs(deltaTSeconds(jd + ut / 86400) - ut), `JD ${jd}`)
        .toBeLessThan(0.1);
    }
  });
});
