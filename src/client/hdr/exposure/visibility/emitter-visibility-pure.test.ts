import { describe, expect, it } from 'vitest';
import {
  brightnessSkip,
  EIGHT_BIT_HALF_STEP,
  emitterPeakDisplayLevel,
  emitterPutsInkOnScreen,
  extendedEmitterPeakDisplayLevel,
  extendedEmitterPutsInkOnScreen,
  taperFactor,
  type EmitterInkArgs,
  type FrameExposure,
} from './emitter-visibility-pure';
import {
  sceneExposure,
  summationSolidAngleFor,
  thresholdMagFor,
} from '../exposure-epoch';
import {
  adaptationBranches,
  adaptationDm,
  type FrameStatistic,
} from '../scene-adaptation-pure';
import {
  extendedThresholdSbFromSolidAngle,
  pixelSolidAngleArcsec2,
  surfaceBrightnessLuminance,
} from '../../emission/emission-pure';
import { makeFrameExposure } from '../../../scene/frame-ctx-mock';
import { MW_PEAK_SB_DUST_FREE } from '../../../milkyway/band-peak-pure';
import { DR_MAG, TOE_BLACK_MAG, tonemapWhitePoint } from '../../tonemap/tonemap-pure';
import { SOFT_TAPER_MARGIN_MAG } from '../../../solar-system/perceptual-magnitude';
import { DEFAULT_INSTRUMENT, instrumentLimitMag } from '../../../filters/filter-state';

const LIMIT = instrumentLimitMag(DEFAULT_INSTRUMENT);
const WHITE = tonemapWhitePoint(DR_MAG);

function star(overrides: Partial<EmitterInkArgs> = {}): EmitterInkArgs {
  const thresholdMag = thresholdMagFor(LIMIT, 0);
  return {
    appMag: thresholdMag,
    exposure: sceneExposure(LIMIT, 0, 0),
    thresholdMag,
    physRadiusPx: 0,
    whitePoint: WHITE,
    tapered: true,
    ...overrides,
  };
}

/** Smallest magnitudes-past-threshold at which the emitter stops
 *  putting ink on screen, to 1e-4 mag. */
function inkEdgeMagPastThreshold(base: EmitterInkArgs): number {
  let lo = -20;
  let hi = SOFT_TAPER_MARGIN_MAG;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const lit = emitterPutsInkOnScreen({ ...base, appMag: base.thresholdMag + mid });
    if (lit) lo = mid; else hi = mid;
  }
  return hi;
}

describe('taperFactor', () => {
  it('mirrors the glow pass smoothstep across the taper band', () => {
    expect(taperFactor(7.8, 7.8, true)).toBe(1);
    expect(taperFactor(7.8 + SOFT_TAPER_MARGIN_MAG / 2, 7.8, true)).toBeCloseTo(0.5, 12);
    expect(taperFactor(7.8 + SOFT_TAPER_MARGIN_MAG, 7.8, true)).toBe(0);
    expect(taperFactor(9, 7.8, true)).toBe(0);
  });

  it('hard-cuts at the threshold for disc-dominated emitters', () => {
    expect(taperFactor(7.8, 7.8, false)).toBe(1);
    expect(taperFactor(7.80001, 7.8, false)).toBe(0);
  });
});

describe('emitterPeakDisplayLevel', () => {
  // hdr/tonemap/README.md § Operator: "L = L_THRESH resolves to 0.15 of full
  // scale after encode". A source at the threshold carries exactly
  // L_THRESH by construction, so this pins the whole chain end to end.
  it('puts a threshold source at 0.15 of full scale on an unadapted frame', () => {
    expect(emitterPeakDisplayLevel(star())).toBeCloseTo(0.15001, 5);
  });

  it('spreads a resolved disc over its area, dimming the peak', () => {
    const point = emitterPeakDisplayLevel(star());
    const resolved = emitterPeakDisplayLevel(star({ physRadiusPx: 10 }));
    expect(resolved).toBeLessThan(point);
  });
});

describe('emitterPutsInkOnScreen — the pick gate the shipped cutoff misses', () => {
  // The bug: drawCutoffMag admits stars out to threshold + 0.5, where
  // the taper is exactly zero. Nothing in the last stretch renders.
  it('renders nothing at the shipped draw cutoff', () => {
    const s = star();
    expect(
      emitterPeakDisplayLevel({ ...s, appMag: s.thresholdMag + SOFT_TAPER_MARGIN_MAG }),
    ).toBe(0);
    expect(
      emitterPutsInkOnScreen({ ...s, appMag: s.thresholdMag + SOFT_TAPER_MARGIN_MAG }),
    ).toBe(false);
  });

  it('goes dark well before the shipped cutoff, and that gap is the bug', () => {
    const edge = inkEdgeMagPastThreshold(star());
    expect(edge).toBeLessThan(SOFT_TAPER_MARGIN_MAG);
    expect(edge).toBeCloseTo(0.3066, 4);
  });

  // Dust: the picker's magnitude is intrinsic, the shader's is extincted.
  it('drops a threshold star behind one magnitude of dust', () => {
    const s = star();
    expect(emitterPutsInkOnScreen(s)).toBe(true);
    expect(emitterPutsInkOnScreen({ ...s, appMag: s.thresholdMag + 1 })).toBe(false);
  });

  // Adaptation: uThresholdMag excludes dm, uExposure carries it.
  it('drops the whole faint end once the frame adapts', () => {
    const thresholdMag = thresholdMagFor(LIMIT, 0);
    const adapted = (dm: number) =>
      emitterPutsInkOnScreen(star({ exposure: sceneExposure(LIMIT, dm, 0), thresholdMag }));
    expect(adapted(0)).toBe(true);
    expect(adapted(-1)).toBe(true);
    expect(adapted(-2)).toBe(false);
    expect(adapted(-14)).toBe(false);
  });

  it('lets the EV trim reveal a star the unadapted frame hides', () => {
    const dim = star({ appMag: thresholdMagFor(LIMIT, 0) + 0.45 });
    expect(emitterPutsInkOnScreen(dim)).toBe(false);
    const trimmed = thresholdMagFor(LIMIT, 3);
    expect(
      emitterPutsInkOnScreen({
        ...dim,
        exposure: sceneExposure(LIMIT, 0, 3),
        thresholdMag: trimmed,
      }),
    ).toBe(true);
  });

  it('is exactly the half-step comparison, with no hidden margin', () => {
    const s = star();
    const edge = inkEdgeMagPastThreshold(s);
    const justLit = emitterPeakDisplayLevel({ ...s, appMag: s.thresholdMag + edge - 1e-3 });
    expect(justLit).toBeGreaterThanOrEqual(EIGHT_BIT_HALF_STEP);
  });
});

describe('the extended-source sibling', () => {
  // docs/science-hdr-pipeline.md § 3.5. No taper — that is a point-source
  // term — and the peak is a surface brightness over the rod summation
  // area rather than a flux over a display kernel.
  const OMEGA_SUM = summationSolidAngleFor(DEFAULT_INSTRUMENT);

  /** Smallest S_peak at which the emitter stops putting ink on screen at
   *  `dm` magnitudes of cut, to 1e-4 mag. */
  function extendedInkEdgeSb(dm: number): number {
    const exposure = sceneExposure(LIMIT, dm, 0);
    let lo = 0;
    let hi = 80;
    for (let i = 0; i < 300; i++) {
      const mid = (lo + hi) / 2;
      if (extendedEmitterPutsInkOnScreen(mid, exposure, OMEGA_SUM, WHITE)) lo = mid;
      else hi = mid;
    }
    return hi;
  }

  it('puts the visibility edge at S_lim + dm + TOE_BLACK_MAG', () => {
    const sLim = extendedThresholdSbFromSolidAngle(OMEGA_SUM, LIMIT);
    expect(sLim).toBeCloseTo(22.0, 6);
    expect(extendedInkEdgeSb(0)).toBeCloseTo(sLim + TOE_BLACK_MAG, 4);
    // Adaptation rides uExposure, so it moves the edge one for one while
    // every magnitude bound stays where it was.
    expect(extendedInkEdgeSb(-6.29)).toBeCloseTo(sLim + TOE_BLACK_MAG - 6.29, 4);
  });

  it('is exactly the half-step comparison, with no hidden margin', () => {
    const edge = extendedInkEdgeSb(0);
    const exposure = sceneExposure(LIMIT, 0, 0);
    expect(extendedEmitterPeakDisplayLevel(edge - 1e-3, exposure, OMEGA_SUM, WHITE))
      .toBeGreaterThanOrEqual(EIGHT_BIT_HALF_STEP);
    expect(extendedEmitterPeakDisplayLevel(edge + 1e-3, exposure, OMEGA_SUM, WHITE))
      .toBeLessThan(EIGHT_BIT_HALF_STEP);
  });
});

describe('the brightness skip — § 3.5 rules 1 and 2', () => {
  /** The app default view: `L̄` = 68.6 at the base exposure and no lit
   *  resolved surface, which the display floor turns into a −6.29 cut. */
  const SOL_STAT: FrameStatistic = { meanL: 68.6, coverage: 0, discL: 0 };

  function exposureAt(
    stat: FrameStatistic,
    overrides: Partial<FrameExposure> = {},
  ): FrameExposure {
    const base = makeFrameExposure({ statistic: stat, ...overrides });
    return { ...base, exposure: sceneExposure(LIMIT, adaptationDm(stat), 0) };
  }

  const drawn = (peakSb: number, exposure: FrameExposure) =>
    brightnessSkip({ peakSb: () => peakSb, contributing: true, warpActive: false, exposure });

  it('reproduces § 3.5 default view: a −6.29 cut against a 17.21 threshold', () => {
    expect(adaptationDm(SOL_STAT)).toBeCloseTo(-6.29, 2);
    expect(adaptationBranches(SOL_STAT).regime).toBe('floor');
    const sLim = extendedThresholdSbFromSolidAngle(
      summationSolidAngleFor(DEFAULT_INSTRUMENT), LIMIT);
    expect(sLim + adaptationDm(SOL_STAT) + TOE_BLACK_MAG).toBeCloseTo(17.21, 2);
  });

  it('skips the band at Sol on its dusty peak, never on the dust-free ceiling', () => {
    // The ceiling misses the 17.21 threshold by 0.10 mag and the dusty
    // peak clears it by 3.5 — which is the whole reason the band needs a
    // second tier rather than the constant alone.
    const exposure = exposureAt(SOL_STAT);
    expect(drawn(20.69, exposure)).toBe('brightness');
    expect(drawn(MW_PEAK_SB_DUST_FREE, exposure)).toBeNull();
  });

  it('skips the LG glow at Sol — M31 bounds 0.2 mag under the threshold', () => {
    expect(drawn(17.42, exposureAt(SOL_STAT))).toBe('brightness');
  });

  it('refuses every skip at no cut', () => {
    const exposure = makeFrameExposure();
    expect(adaptationDm(exposure.statistic!)).toBe(0);
    for (const peakSb of [20.69, 17.42, MW_PEAK_SB_DUST_FREE]) {
      expect(drawn(peakSb, exposure)).toBeNull();
    }
  });

  it('refuses a skip while warping, and before any statistic has landed', () => {
    const exposure = exposureAt(SOL_STAT);
    expect(brightnessSkip({
      peakSb: () => 20.69, contributing: true, warpActive: true, exposure,
    })).toBeNull();
    expect(drawn(20.69, exposureAt(SOL_STAT, { statistic: null }))).toBeNull();
  });

  // Producing the bound is the expensive half of the verdict — the band
  // marches 976 sightlines, the glow 123 objects' central rays — and a
  // warping camera refuses unconditionally on exactly the frames it moves
  // fastest. So the refusals that do not need the number have to come
  // first, and an eager argument would look identical without this.
  it('never asks for the peak on a refusal that does not need it', () => {
    let asked = 0;
    const peakSb = () => { asked += 1; return 20.69; };
    const refusals = [
      { warpActive: true, exposure: exposureAt(SOL_STAT) },
      { warpActive: false, exposure: exposureAt(SOL_STAT, { statistic: null }) },
    ];
    for (const r of refusals) {
      expect(brightnessSkip({ peakSb, contributing: true, ...r })).toBeNull();
    }
    expect(asked).toBe(0);

    // …and does ask once when the verdict genuinely turns on it. The
    // verdict is asserted rather than the call alone: a predicate that
    // reached the thunk and then threw the answer away would satisfy the
    // count and pin nothing.
    expect(brightnessSkip({
      peakSb, contributing: true, warpActive: false, exposure: exposureAt(SOL_STAT),
    })).toBe('brightness');
    expect(asked).toBe(1);
  });

  describe('rule 2 refuses within a band of the edge, and the band is the plate scale\'s', () => {
    // The share bound carries Ω_px where the display carries Ω_sum, so the
    // fraction of `L̄` a skip removes — and therefore how far past the edge
    // rule 2 keeps refusing — grows quadratically as the field widens.
    // MEASURED, not § 3.5's algebra: the design gate estimates ~0.1 mag at
    // 50° and ~2.5 at 120° and is loose in both directions.
    const EYE_STAT: FrameStatistic = { meanL: 5, coverage: 0, discL: 0 };
    const EDGE_SB = 23.5 + adaptationDm(EYE_STAT);

    /** Widest S_peak past the edge that rule 2 still refuses, to 1e-4. */
    function refusalBandMag(fovDeg: number): number {
      const exposure = exposureAt(EYE_STAT, {
        omegaPxArcsec2: pixelSolidAngleArcsec2(900 / ((fovDeg * Math.PI) / 180)),
      });
      let lo = 0;
      let hi = 12;
      for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2;
        if (drawn(EDGE_SB + mid, exposure) === null) lo = mid; else hi = mid;
      }
      return hi;
    }

    it('is an eye-regime frame, which is the only one rule 2 can bind on', () => {
      expect(adaptationBranches(EYE_STAT).regime).toBe('eye');
    });

    it('is 0.0074 mag at the acceptance 50° field', () => {
      expect(refusalBandMag(50)).toBeCloseTo(0.0074, 4);
    });

    it('is 1.5904 mag at 120°, where Ω_px approaches Ω_sum', () => {
      expect(refusalBandMag(120)).toBeCloseTo(1.5904, 4);
    });

    it('collapses to 0.0003 mag at 10°, where the pixel is tiny', () => {
      expect(refusalBandMag(10)).toBeCloseTo(0.0003, 4);
    });

    it('subtracts the share only while the emitter is drawn', () => {
      // Inside the 120° refusal band the flag decides the verdict outright,
      // which is what makes it load-bearing rather than an optimisation: a
      // DRAWN emitter there stays drawn (its own share is what would move
      // the cut), and a SKIPPED one stays skipped (its share is already out
      // of `L̄`, so subtracting again would double-ease the test).
      const wide = exposureAt(EYE_STAT, {
        omegaPxArcsec2: pixelSolidAngleArcsec2(900 / ((120 * Math.PI) / 180)),
      });
      const justPast = EDGE_SB + 1.0;
      expect(drawn(justPast, wide)).toBeNull();
      expect(brightnessSkip({
        peakSb: () => justPast, contributing: false, warpActive: false, exposure: wide,
      })).toBe('brightness');
    });
  });
});

describe('the loop the design gate exists to close', () => {
  // § 3.5's hazard in full: a skipped emitter's light genuinely leaves the
  // next landed statistic, and a drawn one puts it back. Iterating the
  // verdict against a statistic that FOLLOWS it is the only test that can
  // see a 2-cycle; every other test here holds the statistic fixed.
  const FULL_MEAN_L = 68.6;

  /** The verdict sequence over `steps` landings, each reflecting whether
   *  the emitter drew on the one before. */
  function iterate(peakSb: number, shareOfMean: number, steps = 12): string[] {
    let contributing = true;
    const out: string[] = [];
    for (let i = 0; i < steps; i++) {
      const stat: FrameStatistic = {
        meanL: contributing ? FULL_MEAN_L : FULL_MEAN_L - shareOfMean,
        coverage: 0,
        discL: 0,
      };
      const exposure = {
        ...makeFrameExposure({ statistic: stat }),
        exposure: sceneExposure(LIMIT, adaptationDm(stat), 0),
      };
      const verdict = brightnessSkip({
        peakSb: () => peakSb, contributing, warpActive: false, exposure,
      });
      out.push(verdict === null ? 'draw' : 'skip');
      contributing = verdict === null;
    }
    return out;
  }

  it('settles on M31 at every share the bound admits', () => {
    // 0.0081 is § 3.5's own bound on the band's share from Sol. The rest
    // are absurd on purpose: the loop has to settle across orders of
    // magnitude, not just at the figure the design gate quotes.
    for (const share of [0.0081, 0.1, 1, 5, 20, 40]) {
      expect(new Set(iterate(17.42, share))).toEqual(new Set(['skip']));
    }
  });

  it('settles on the band, whose peak clears the threshold by 3.5 mag', () => {
    for (const share of [0.0081, 1, 20, 40]) {
      expect(new Set(iterate(20.69, share))).toEqual(new Set(['skip']));
    }
  });

  it('2-cycles ONLY where the true share exceeds the bound — which it cannot', () => {
    // The failure mode stated exactly: rule 2 protects to the extent that
    // the share bound really bounds. At 60 of a 68.6 mean the emitter is
    // 87 % of the frame, removing it lifts `L̄` clear out of the floor
    // regime, the cut eases 0.92 mag and the emitter is visible again —
    // while the bound still predicts 1.3e-4 and lets the skip through.
    expect(iterate(17.42, 60).slice(0, 4)).toEqual(['skip', 'draw', 'skip', 'draw']);
    // It is unreachable because the bound takes the emitter's PEAK over the
    // whole frame: a true share above it would need a mean brighter than
    // the emitter's own brightest pixel. This test is the statement of
    // what the bound has to keep being, not a known defect.
    const peakShareBound = surfaceBrightnessLuminance(
      makeFrameExposure().baseExposure, 17.42, makeFrameExposure().omegaPxArcsec2);
    expect(peakShareBound).toBeLessThan(1);
    expect(peakShareBound).toBeCloseTo(0.1135, 4);
  });
});
