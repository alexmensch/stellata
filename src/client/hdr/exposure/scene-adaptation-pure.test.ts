import { describe, expect, it } from 'vitest';
import { angularToPx } from '../../camera/controls/star-geometry';
import { PLANET_PARK_FILL_FRACTION } from '../../camera/controls/star-physics';
import { ARCSEC_TO_RAD } from '../../util/astronomy-constants';
import {
  SB_ZERO_POINT,
  luminanceForMagnitude,
  pixelSolidAngleArcsec2,
  surfaceBrightnessLuminance,
} from '../emission/emission-pure';
import { EV_MAX_STOPS, exposureForMagLimit, MAG_PER_STOP } from './exposure-epoch';
import {
  SOL_GALACTOCENTRIC_PC,
  galacticDirection,
  sightlineSurfaceBrightness,
} from '../../milkyway/milkyway-column-pure';
import { tonemapWhitePoint } from '../tonemap-pure';
import {
  ADAPT_REF_COVERAGE,
  adaptationDm,
  adaptedDiscMeanL,
  DISC_PEAK_OVER_MEAN,
  eyeAdaptationDm,
  guardHandoverCoverage,
  highlightGuardDm,
  L_ADAPT,
  L_CAP,
  L_TARGET,
  trimStopsForCoverage,
} from './scene-adaptation-pure';

// docs/science-hdr-pipeline.md § 3.1's reference frame: the default
// instrument at EV 0 on a 1920×1080 viewport at its 50° FOV. Every
// contribution below is quoted against exactly this.
const VIEWPORT_W = 1920;
const VIEWPORT_H = 1080;
const VIEWPORT_AREA_PX = VIEWPORT_W * VIEWPORT_H;
const FOV_Y_RAD = (50 * Math.PI) / 180;
const EXPOSURE = exposureForMagLimit(7.8);
const OMEGA_PX = pixelSolidAngleArcsec2(angularToPx(VIEWPORT_H, FOV_Y_RAD));
/** Share of the sphere this frame covers — what turns a whole-sky
 *  population into a per-frame one. */
const FRAME_SKY_FRACTION =
  (VIEWPORT_AREA_PX * OMEGA_PX) / (4 * Math.PI / (ARCSEC_TO_RAD * ARCSEC_TO_RAD));

/** L_THRESH by construction: a source at the instrument's limit. */
const THRESHOLD_STAR_L = luminanceForMagnitude(EXPOSURE, 7.8);

/** The whole diffuse field the walk era carried as `DIFFUSE_FIELD_L`:
 *  the frame's share of the threshold-star population plus the Milky Way
 *  band. Both are measured out of the buffer now; this is what they sum
 *  to, and it is the floor the must-not-adapt cases sit on. */
const AGGREGATE_FIELD_L = 4.05e-4;

/** What a source of apparent magnitude `m` adds to `L̄` once the frame has
 *  drawn it: its whole flux spread over the frame. The buffer reduction
 *  measures exactly this — the kernel's flux-correct renormalisation is
 *  what makes the mean over the drawn pixels come out here. */
function contribution(appMag: number): number {
  return luminanceForMagnitude(EXPOSURE, appMag) / VIEWPORT_AREA_PX;
}

describe('scene-adaptation constants', () => {
  it('pins the measured target and the anchor derived from it', () => {
    expect(L_TARGET).toBe(0.89);
    expect(ADAPT_REF_COVERAGE).toBe(0.0685);
    expect(L_ADAPT).toBeCloseTo(0.060965, 12);
    expect(L_CAP).toBe(1.8);
  });

  it('keeps the guard-governed disc mean where the source walk left it', () => {
    // The buffer max returns a true brightest pixel where the walk
    // returned a disc mean, so L_CAP moved by exactly the Lambert disc's
    // peak-over-mean and the level a resolved body settles at did not.
    expect(DISC_PEAK_OVER_MEAN).toBe(1.5);
    expect(L_CAP / DISC_PEAK_OVER_MEAN).toBeCloseTo(1.2, 12);
    expect(2.5 * Math.log10(DISC_PEAK_OVER_MEAN)).toBeCloseTo(0.44, 2);
  });

  it('derives the reference coverage from the park framing', () => {
    // A parked body fills PARK_FILL of the viewport's MINOR axis, so its
    // disc area over the frame area is what the anchor is calibrated on.
    const parkCoverage = (w: number, h: number) =>
      (Math.PI * (0.5 * PLANET_PARK_FILL_FRACTION * Math.min(w, h)) ** 2) / (w * h);
    // The calibration viewport was portrait, so its minor axis is width.
    expect(parkCoverage(1280, 1320)).toBeCloseTo(ADAPT_REF_COVERAGE, 3);
  });

  it('lands the three independently-judged planets within 0.15 mag of L_TARGET', () => {
    // The smoke pass's disc-mean luminances (§ 3.1). Their agreement
    // across a 40× spread in intrinsic surface brightness is what makes
    // L_TARGET data rather than taste.
    const measured = { neptune: 0.919, uranus: 0.824, jupiter: 0.940 };
    for (const l of Object.values(measured)) {
      expect(Math.abs(2.5 * Math.log10(l / L_TARGET))).toBeLessThan(0.15);
    }
    // Mid-grey — the proposal the measurement retired — is not.
    expect(2.5 * Math.log10(0.272 / L_TARGET)).toBeCloseTo(-1.29, 2);
  });
});

describe('§ 3.1 contribution table', () => {
  it('adapts to a resolved planet filling a fifth of the frame', () => {
    // Venus: S₀ = +0.78 mag/arcsec², the closed form in
    // solar-system/planets/README.md § Physical-luminance emission.
    const surfaceL = surfaceBrightnessLuminance(EXPOSURE, 0.78, OMEGA_PX);
    expect(surfaceL).toBeCloseTo(3.57e5, -3);
    // Coverage cancels against the disc's own area, so the contribution
    // is surface brightness × coverage however the disc is expressed.
    const coverage = 0.2;
    const appMag = -2.5 * Math.log10((surfaceL * coverage * VIEWPORT_AREA_PX) / EXPOSURE);
    expect(contribution(appMag)).toBeCloseTo(7.1e4, -3);
    expect(eyeAdaptationDm(surfaceL * coverage)).toBeCloseTo(-15.17, 2);
  });

  it('adapts hardest to Sol at 1 AU, and still cannot expose its disc', () => {
    const solDiameterPx = (0.53 * 3600) / (206264.806 / angularToPx(VIEWPORT_H, FOV_Y_RAD));
    expect(solDiameterPx).toBeCloseTo(11.45, 2);
    expect(Math.PI * (0.5 * solDiameterPx) ** 2).toBeCloseTo(103, 0);
    const mean = contribution(-26.74);
    expect(mean).toBeCloseTo(6.3e5, -4);
    const dm = eyeAdaptationDm(mean);
    expect(dm).toBeCloseTo(-17.54, 2);
    // § 3.2's accepted exception. Sol's disc reads −10.59 mag/arcsec², so
    // bringing it under the white point takes −22 mag; adaptation plus a
    // full negative trim reaches −19.8 and the disc stays clipped white.
    const discL = surfaceBrightnessLuminance(EXPOSURE, -10.59, OMEGA_PX);
    const neededCut = -2.5 * Math.log10(discL / tonemapWhitePoint());
    expect(neededCut).toBeCloseTo(-22.0, 1);
    const reach = dm - EV_MAX_STOPS * MAG_PER_STOP;
    expect(reach).toBeCloseTo(-19.80, 2);
    expect(reach - neededCut).toBeCloseTo(2.20, 1);
  });

  it('ignores the cases that must not adapt', () => {
    // Venus from Earth: brilliant, and a third of a pixel wide.
    const venusFromEarth = contribution(-4.4);
    expect(venusFromEarth).toBeCloseTo(7.3e-4, 5);
    expect(eyeAdaptationDm(0)).toBe(0);
    expect(eyeAdaptationDm(venusFromEarth)).toBe(0);
  });

  it('measures the aggregate field the walk era carried as a constant', () => {
    // A 50° frame is a tenth of the sphere, so the whole-sky
    // threshold-star population is an order of magnitude too many for it.
    expect(FRAME_SKY_FRACTION).toBeCloseTo(0.1077, 4);
    const thresholdStars =
      (1e5 * FRAME_SKY_FRACTION * THRESHOLD_STAR_L) / VIEWPORT_AREA_PX;
    // The band's anticentre-plane surface brightness, taken from the layer
    // rather than copied: the Milky Way layer is the authority on how
    // bright the band is, and a literal here goes stale the next time its
    // calibration moves. It has, twice.
    const bandAnticentreSb = sightlineSurfaceBrightness(
      SB_ZERO_POINT,
      SOL_GALACTOCENTRIC_PC,
      galacticDirection(180, 0),
    );
    const milkyWayBand = surfaceBrightnessLuminance(EXPOSURE, bandAnticentreSb, OMEGA_PX);
    expect(bandAnticentreSb).toBeCloseTo(23.47, 2);
    expect(thresholdStars).toBeCloseTo(1.04e-4, 5);
    expect(milkyWayBand).toBeCloseTo(3.0e-4, 5);
    expect(milkyWayBand / thresholdStars).toBeCloseTo(2.9, 1);
    // Both rows are drawn light now, so both land in the buffer rather
    // than in a constant — and both are inert either way: their sum
    // cannot reach the anchor on its own, with two decades to spare.
    expect(thresholdStars + milkyWayBand).toBeCloseTo(AGGREGATE_FIELD_L, 5);
    expect((thresholdStars + milkyWayBand) * 50).toBeLessThan(L_ADAPT);
  });

  it('separates the two regimes by nearly eight decades', () => {
    const mustAdapt = surfaceBrightnessLuminance(EXPOSURE, 0.78, OMEGA_PX) * 0.2;
    const mustNot = contribution(-4.4) + AGGREGATE_FIELD_L;
    expect(Math.log10(mustAdapt / mustNot)).toBeCloseTo(7.8, 1);
  });
});

describe('dm', () => {
  it('is exactly zero on an empty dark frame', () => {
    expect(eyeAdaptationDm(0)).toBe(0);
    expect(eyeAdaptationDm(L_ADAPT)).toBe(0);
  });

  it('never goes positive — nothing adapts to see fainter than threshold', () => {
    for (const l of [0, 1e-9, 8e-4, 0.5 * L_ADAPT, L_ADAPT, 1e6]) {
      expect(eyeAdaptationDm(l)).toBeLessThanOrEqual(0);
    }
  });

  it('cuts one magnitude per magnitude of overshoot', () => {
    expect(eyeAdaptationDm(L_ADAPT * 10 ** 0.4)).toBeCloseTo(-1, 12);
    expect(eyeAdaptationDm(L_ADAPT * 100)).toBeCloseTo(-5, 12);
  });
});

describe('the highlight guard', () => {
  it('hands over at a pure coverage threshold, and continuously', () => {
    const handover = guardHandoverCoverage();
    expect(handover).toBeCloseTo(0.0508, 4);
    // A body of coverage f: L̄ is its disc mean × f, and the buffer's peak
    // is that mean × the Lambert peak-over-mean. The two cuts agree at the
    // handover whatever the surface brightness is — the threshold is
    // coverage alone, and there is no fade band because they are equal.
    for (const discMeanL of [12, 3.6e5, 1.3e12]) {
      const peak = discMeanL * DISC_PEAK_OVER_MEAN;
      expect(eyeAdaptationDm(discMeanL * handover))
        .toBeCloseTo(highlightGuardDm(peak), 9);
      expect(eyeAdaptationDm(discMeanL * handover * 0.999))
        .toBeGreaterThan(highlightGuardDm(peak));
      expect(eyeAdaptationDm(discMeanL * handover * 1.001))
        .toBeLessThan(highlightGuardDm(peak));
    }
  });

  it('only ever raises the exposure', () => {
    for (const meanL of [0, 1e-3, L_ADAPT, 1, 1e4, 1e9]) {
      for (const peakL of [0, L_CAP, 1e3, 1e12]) {
        const dm = adaptationDm(meanL, peakL);
        expect(dm).toBeGreaterThanOrEqual(eyeAdaptationDm(meanL));
        expect(dm).toBeLessThanOrEqual(0);
      }
    }
  });

  it('holds a resolved surface at L_CAP whatever it fills', () => {
    // The zoom-invariance the guard buys: one body, three framings, the
    // same reading. A resolved disc's peak does not change with zoom.
    const discMeanL = 3.6e5;
    const peak = discMeanL * DISC_PEAK_OVER_MEAN;
    for (const f of [0.1, 0.4, 0.95]) {
      const dm = adaptationDm(discMeanL * f, peak);
      expect(peak * 10 ** (0.4 * dm)).toBeCloseTo(L_CAP, 4);
      expect(adaptedDiscMeanL(f) * DISC_PEAK_OVER_MEAN).toBeCloseTo(L_CAP, 12);
    }
  });

  it('leaves a point source clipped — it protects surfaces, not points', () => {
    // Sol's disc at 1 AU is 103 px of 2.07e6, far below the handover, so
    // the perception branch governs and § 3.2's accepted exception stands.
    const meanL = contribution(-26.74);
    const peak = (luminanceForMagnitude(EXPOSURE, -26.74) / 103) * DISC_PEAK_OVER_MEAN;
    expect(adaptationDm(meanL, peak)).toBe(eyeAdaptationDm(meanL));
    expect(peak * 10 ** (0.4 * eyeAdaptationDm(meanL))).toBeGreaterThan(tonemapWhitePoint());
  });
});

describe('coverage sensitivity (§ 3.2)', () => {
  it('lands the reference coverage on L_TARGET under the perception branch', () => {
    expect(L_ADAPT / ADAPT_REF_COVERAGE).toBeCloseTo(L_TARGET, 12);
    // Park coverage sits ABOVE the handover, though, so what actually
    // happens there is the guard — 0.43 stops over the measured target.
    expect(ADAPT_REF_COVERAGE).toBeGreaterThan(guardHandoverCoverage());
    expect(adaptedDiscMeanL(ADAPT_REF_COVERAGE)).toBeCloseTo(1.2, 12);
    expect(trimStopsForCoverage(ADAPT_REF_COVERAGE)).toBeCloseTo(-0.431, 3);
  });

  it('drifts by the coverage ratio below the handover, and is flat above', () => {
    // Half the reference coverage is under the handover, so the
    // perception branch governs and the trim buys back log2(f/f_ref).
    expect(trimStopsForCoverage(0.5 * ADAPT_REF_COVERAGE)).toBeCloseTo(-1, 12);
    // ±3 stops = ±2.26 mag = a factor 8 in coverage, so the envelope the
    // trim can pull back to L_TARGET starts at 0.86% of the frame.
    const floor = ADAPT_REF_COVERAGE / 2 ** EV_MAX_STOPS;
    expect(floor).toBeCloseTo(0.008563, 6);
    expect(trimStopsForCoverage(floor)).toBeCloseTo(-EV_MAX_STOPS, 12);
    // Above the handover the guard pins the level, so the trim a body
    // needs stops depending on how much of the frame it fills.
    for (const f of [2 * ADAPT_REF_COVERAGE, 0.3, 0.9]) {
      expect(trimStopsForCoverage(f))
        .toBeCloseTo(Math.log2(L_TARGET * DISC_PEAK_OVER_MEAN / L_CAP), 12);
    }
  });
});
