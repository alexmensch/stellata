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
  ADAPT_DISPLAY_FLOOR_DM,
  ADAPT_DOT_COVERAGE,
  ADAPT_PIN_COVERAGE,
  ADAPT_REF_COVERAGE,
  ADAPT_SLEW_SETTLE_MAG,
  adaptationBranches,
  adaptationDm,
  adaptedDiscMeanL,
  DEFAULT_ADAPTATION_TUNING,
  displayFloorDm,
  eyeAdaptationDm,
  L_ADAPT,
  L_TARGET,
  loneBodyStatistic,
  slewDm,
  surfacesStatistic,
  surfaceMeanL,
  surfacePinDm,
  surfacePinWeight,
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
const AGGREGATE_FIELD_L = 1.201e-3;

/** What a source of apparent magnitude `m` adds to `L̄` once the frame has
 *  drawn it: its whole flux spread over the frame. The buffer reduction
 *  measures exactly this — the kernel's flux-correct renormalisation is
 *  what makes the mean over the drawn pixels come out here. */
function contribution(appMag: number): number {
  return luminanceForMagnitude(EXPOSURE, appMag) / VIEWPORT_AREA_PX;
}

/** A frame with light in it but no lit resolved surface — a star field, a
 *  point-source disc, the band. Every emitter that draws a kernel or a
 *  diffuse column writes mask 0. */
function pointFrame(meanL: number) {
  return { meanL, surfaceL: 0, coverage: 0 };
}

describe('scene-adaptation constants', () => {
  it('pins the measured target and the anchor derived from it', () => {
    expect(L_TARGET).toBe(0.89);
    expect(ADAPT_REF_COVERAGE).toBe(0.0685);
    expect(L_ADAPT).toBeCloseTo(0.060965, 12);
  });

  it('derives both ends of the coverage ramp rather than tuning them', () => {
    // The top is the park framing, where the pin and the perception branch
    // agree exactly for a body-dominated frame — so the ramp closes with no
    // step of its own. The foot is the smallest framing the ±3-stop trim
    // could still pull back to L_TARGET; under it a body is past the trim's
    // reach and § 3.2's brilliant dot is the honest reading.
    expect(ADAPT_PIN_COVERAGE).toBe(ADAPT_REF_COVERAGE);
    expect(ADAPT_DOT_COVERAGE).toBeCloseTo(0.0085625, 7);
    expect(ADAPT_PIN_COVERAGE / ADAPT_DOT_COVERAGE).toBeCloseTo(2 ** EV_MAX_STOPS, 12);
    expect(surfacePinWeight(ADAPT_PIN_COVERAGE)).toBe(1);
    expect(surfacePinWeight(ADAPT_DOT_COVERAGE)).toBe(0);
    expect(surfacePinWeight(0)).toBe(0);
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
    // Well over the pin coverage, so what applies is the pin — and it
    // lands the disc mean on L_TARGET, not 1.17 mag over it.
    expect(adaptedDiscMeanL(coverage, surfaceL)).toBeCloseTo(L_TARGET, 9);
  });

  it('measures Sol at 1 AU hardest, and applies only the display floor', () => {
    const solDiameterPx = (0.53 * 3600) / (206264.806 / angularToPx(VIEWPORT_H, FOV_Y_RAD));
    expect(solDiameterPx).toBeCloseTo(11.45, 2);
    expect(Math.PI * (0.5 * solDiameterPx) ** 2).toBeCloseTo(103, 0);
    const mean = contribution(-26.74);
    expect(mean).toBeCloseTo(6.3e5, -4);
    // The scene measurement is untouched by the floor…
    expect(eyeAdaptationDm(mean)).toBeCloseTo(-17.54, 2);
    // …and the applied cut is the floor exactly. A host star draws a
    // kernel, so it writes no mask however much of the frame it fills:
    // the pin cannot reach this frame at any distance.
    const discL = surfaceBrightnessLuminance(EXPOSURE, -10.59, OMEGA_PX);
    expect(adaptationDm(pointFrame(mean))).toBe(ADAPT_DISPLAY_FLOOR_DM);
    // § 3.2's accepted exception survives, by a wider margin than before:
    // the disc needs −22 mag to fall under the white point and the floor
    // plus a full negative trim reaches −8.55, so it stays clipped white.
    const neededCut = -2.5 * Math.log10(discL / tonemapWhitePoint());
    expect(neededCut).toBeCloseTo(-22.0, 1);
    const reach = ADAPT_DISPLAY_FLOOR_DM - EV_MAX_STOPS * MAG_PER_STOP;
    expect(reach).toBeCloseTo(-8.55, 2);
    expect(reach - neededCut).toBeCloseTo(13.45, 1);
    // What the floor buys: the field's effective limit with Sol in frame
    // is m 1.51 — Sirius-class stars survive — where −17.5 left nothing.
    expect(7.8 + ADAPT_DISPLAY_FLOOR_DM).toBeCloseTo(1.51, 2);
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
    expect(bandAnticentreSb).toBeCloseTo(22.061, 3);
    expect(thresholdStars).toBeCloseTo(1.04e-4, 5);
    expect(milkyWayBand).toBeCloseTo(1.097e-3, 5);
    expect(milkyWayBand / thresholdStars).toBeCloseTo(10.56, 2);
    // Both rows are drawn light now, so both land in the buffer rather
    // than in a constant — and both are inert either way: their sum
    // cannot reach the anchor on its own, with two decades to spare.
    expect(thresholdStars + milkyWayBand).toBeCloseTo(AGGREGATE_FIELD_L, 5);
    expect((thresholdStars + milkyWayBand) * 50).toBeLessThan(L_ADAPT);
  });

  it('separates the two regimes by more than seven decades', () => {
    const mustAdapt = surfaceBrightnessLuminance(EXPOSURE, 0.78, OMEGA_PX) * 0.2;
    const mustNot = contribution(-4.4) + AGGREGATE_FIELD_L;
    expect(Math.log10(mustAdapt / mustNot)).toBeCloseTo(7.6, 1);
  });
});

// The parked cut must be a fixed point of the APPLIED value. Returning the
// measurement inside the band made the slew a unity-gain pass-through for
// the fp16 readback quantiser: uExposure alternated two adjacent values
// (~7e-4 mag apart, permanently inside the band) frame to frame forever.
describe('slewDm', () => {
  it('blends toward a measurement outside the band', () => {
    expect(slewDm(0, -1, 0.5)).toBe(-0.5);
  });

  it('holds the applied cut bit-identical inside the band', () => {
    const applied = -2.0004;
    expect(slewDm(applied, applied + 0.7 * ADAPT_SLEW_SETTLE_MAG, 0.63)).toBe(applied);
    expect(slewDm(applied, applied - 0.7 * ADAPT_SLEW_SETTLE_MAG, 0.63)).toBe(applied);
  });

  it('collapses a no-cut park to exactly 0 — the skip-if-unchanged sentinel', () => {
    // An asymptote at ~1e-4 would rewrite the uniform forever on a frame
    // no term asked a cut on.
    expect(slewDm(-0.5 * ADAPT_SLEW_SETTLE_MAG, 0.3 * ADAPT_SLEW_SETTLE_MAG, 0.5)).toBe(0);
    expect(slewDm(0, 0, 0.5)).toBe(0);
  });
});

describe('dm', () => {
  it('is exactly zero on an empty dark frame', () => {
    expect(eyeAdaptationDm(0)).toBe(0);
    expect(eyeAdaptationDm(L_ADAPT)).toBe(0);
    expect(adaptationDm({ meanL: 0, surfaceL: 0, coverage: 0 })).toBe(0);
  });

  it('never goes positive — nothing adapts to see fainter than threshold', () => {
    for (const l of [0, 1e-9, 8e-4, 0.5 * L_ADAPT, L_ADAPT, 1e6]) {
      expect(eyeAdaptationDm(l)).toBeLessThanOrEqual(0);
    }
    for (const coverage of [0, 1e-4, ADAPT_DOT_COVERAGE, 0.03, ADAPT_PIN_COVERAGE, 0.9]) {
      for (const discL of [0, 0.5, L_TARGET, 12, 3.6e5, 1e12]) {
        expect(adaptationDm(loneBodyStatistic(coverage, discL))).toBeLessThanOrEqual(0);
      }
    }
  });

  it('cuts one magnitude per magnitude of overshoot', () => {
    expect(eyeAdaptationDm(L_ADAPT * 10 ** 0.4)).toBeCloseTo(-1, 12);
    expect(eyeAdaptationDm(L_ADAPT * 100)).toBeCloseTo(-5, 12);
  });
});

describe('the resolved-surface pin', () => {
  it('holds a body at L_TARGET whatever it fills, from park inward', () => {
    // The binding constraint: a body must not dim as the camera approaches
    // it. From park to full-viewport fill the pin governs alone and the
    // reading is identical at every framing.
    for (const discMeanL of [12, 3.6e5, 1.3e12]) {
      for (const f of [ADAPT_PIN_COVERAGE, 0.1, 0.4, 0.95]) {
        expect(adaptedDiscMeanL(f, discMeanL)).toBeCloseTo(L_TARGET, 9);
        expect(trimStopsForCoverage(f, discMeanL)).toBeCloseTo(0, 9);
      }
    }
  });

  it('is independent of everything else in the frame', () => {
    // D is a masked mean over masked area, so a glare halo, a star field or
    // the band raise L̄ without moving the pin — the coverage- and
    // texture-independence the whole fix rests on.
    const body = loneBodyStatistic(0.3, 3.6e5);
    const withField = { ...body, meanL: body.meanL * 40 };
    expect(surfaceMeanL(withField)).toBe(surfaceMeanL(body));
    expect(adaptationDm(withField)).toBe(adaptationDm(body));
  });

  it('area-weights the surfaces sharing one frame', () => {
    // A globe and its ring annulus are one subject: D is the mean over every
    // masked texel, so the larger area leads and neither is exposed for alone.
    const globe = { coverage: 0.02, discMeanL: 4e5 };
    const rings = { coverage: 0.07, discMeanL: 1e5 };
    const stat = surfacesStatistic([globe, rings]);
    expect(stat.coverage).toBeCloseTo(0.09, 12);
    expect(surfaceMeanL(stat)).toBeCloseTo((0.02 * 4e5 + 0.07 * 1e5) / 0.09, 6);
    // Between the two, and nearer the annulus, which covers 3.5x the globe.
    expect(surfaceMeanL(stat)).toBeGreaterThan(rings.discMeanL);
    expect(surfaceMeanL(stat)).toBeLessThan(globe.discMeanL);
  });

  it('over-exposes by exactly the dark area a mis-masked emitter claims', () => {
    // The defect the ring-shadow and night-limb gates exist to prevent: a
    // claimer counting area its own light term has gone to zero over. D falls
    // by the coverage ratio, and every stop of that lands on the subject.
    // Both framings sit above ADAPT_PIN_COVERAGE, so the pin governs alone in
    // each and the ramp weight cannot muddy the comparison.
    const body = { coverage: 0.2, discMeanL: 3.6e5 };
    const honest = surfacesStatistic([body]);
    const withDark = surfacesStatistic([body, { coverage: 0.2, discMeanL: 0 }]);
    expect(surfaceMeanL(withDark)).toBeCloseTo(0.5 * surfaceMeanL(honest), 6);
    // Half the measured surface brightness is 0.75 mag of cut not applied.
    expect(adaptationDm(withDark) - adaptationDm(honest)).toBeCloseTo(0.753, 3);
  });

  it('lifts the display floor, which the perception branch never does', () => {
    // Venus at park needs 14.0 mag of cut; the floor stops at 6.29 and must
    // not shallow the pin. This is the regime the ported guard silently
    // dropped every parked planet out of.
    const surfaceL = surfaceBrightnessLuminance(EXPOSURE, 0.78, OMEGA_PX);
    const b = adaptationBranches(loneBodyStatistic(ADAPT_REF_COVERAGE, surfaceL));
    expect(b.regime).toBe('surface');
    expect(b.dm).toBeCloseTo(-14.01, 2);
    expect(b.dm).toBeLessThan(b.floor);
    expect(b.dm).toBe(b.pin);
  });

  it('leaves a point source clipped — it protects surfaces, not points', () => {
    // Sol's disc at 1 AU writes no mask at all, so the perception branch
    // governs (floored) and § 3.2's accepted exception stands.
    const b = adaptationBranches(pointFrame(contribution(-26.74)));
    expect(b.coverage).toBe(0);
    expect(b.pin).toBe(0);
    expect(b.dm).toBe(ADAPT_DISPLAY_FLOOR_DM);
  });

  it('cannot be deepened by a source that draws no surface', () => {
    // The floor is the bound on every frame the pin does not govern, so
    // nothing entering the frame as a kernel or a diffuse column can darken
    // it past that.
    for (const meanL of [0, 1e-3, L_ADAPT, 1, 610, 1e4, 6.3e5, 1e9]) {
      const dm = adaptationDm(pointFrame(meanL));
      expect(dm).toBeGreaterThanOrEqual(ADAPT_DISPLAY_FLOOR_DM);
      expect(dm).toBe(Math.max(eyeAdaptationDm(meanL), ADAPT_DISPLAY_FLOOR_DM));
    }
  });
});

describe('the display floor (§ 3.2)', () => {
  it('is the perception branch evaluated on a full-white frame', () => {
    // The strongest stimulus the display can deliver is every pixel at
    // the white point, so no displayed frame justifies a deeper cut —
    // derived, not tuned.
    expect(ADAPT_DISPLAY_FLOOR_DM).toBe(-2.5 * Math.log10(tonemapWhitePoint() / L_ADAPT));
    expect(ADAPT_DISPLAY_FLOOR_DM).toBeCloseTo(-6.28987, 5);
  });

  it('does not touch cuts the display could genuinely cause', () => {
    // The full Moon at 50° covers 5e-5 of the frame — under the ramp's
    // foot, so the perception branch governs and the applied value stays
    // the scene measurement.
    const meanL = contribution(-12.7);
    expect(eyeAdaptationDm(meanL)).toBeCloseTo(-3.50, 2);
    expect(adaptationDm({ meanL, surfaceL: meanL, coverage: 103 / VIEWPORT_AREA_PX }))
      .toBe(eyeAdaptationDm(meanL));
  });

  it('ramps continuously from the floor to the pin instead of stepping', () => {
    // A Venus-bright disc swept across the whole ramp: the pin (−14.0) and
    // the floor (−6.29) sit 7.7 mag apart, and the blend walks between them
    // over the three stops of coverage the ramp spans.
    const surfaceL = surfaceBrightnessLuminance(EXPOSURE, 0.78, OMEGA_PX);
    const sweep = (c: number) => adaptationDm(loneBodyStatistic(c, surfaceL));
    let prev = sweep(ADAPT_DOT_COVERAGE / 4);
    let maxStep = 0;
    for (let k = -32; k <= 5 * 32; k++) {
      const dm = sweep(ADAPT_DOT_COVERAGE * 2 ** (k / 32));
      maxStep = Math.max(maxStep, Math.abs(dm - prev));
      // Monotone: approaching a body only ever deepens the cut, so it can
      // never brighten and then dim again on the way in.
      expect(dm).toBeLessThanOrEqual(prev + 1e-12);
      prev = dm;
    }
    expect(maxStep).toBeLessThan(0.15);
  });
});

describe('the branch decomposition', () => {
  const BRIGHT = 3.6e5;

  it('is the only implementation — adaptationDm reads its dm', () => {
    for (const stat of [
      loneBodyStatistic(0.4, BRIGHT),
      loneBodyStatistic(1e-3, BRIGHT),
      loneBodyStatistic(0.02, 12),
      { meanL: 0, surfaceL: 0, coverage: 0 },
    ]) {
      expect(adaptationDm(stat)).toBe(adaptationBranches(stat).dm);
    }
  });

  it('names the term that actually set the cut, in all five regimes', () => {
    // Above the ramp: the pin governs alone.
    expect(adaptationBranches(loneBodyStatistic(0.4, BRIGHT)).regime).toBe('surface');
    // Far below it, on a surface bright enough that the floor binds.
    const floorBound = adaptationBranches(loneBodyStatistic(1e-4, BRIGHT));
    expect(floorBound.regime).toBe('floor');
    expect(floorBound.dm).toBe(ADAPT_DISPLAY_FLOOR_DM);
    // A dim body whose own cut never reaches the floor.
    const eyeBound = adaptationBranches(loneBodyStatistic(0.008, 100));
    expect(eyeBound.regime).toBe('eye');
    expect(eyeBound.dm).toBe(eyeBound.eye);
    // Inside the ramp the answer is neither branch: it walks from the
    // floored perception value toward the pin, so it lands between them.
    const ramp = adaptationBranches(loneBodyStatistic(0.5 * ADAPT_PIN_COVERAGE, BRIGHT));
    expect(ramp.regime).toBe('handover');
    expect(ramp.dm).toBeGreaterThan(ramp.pin);
    expect(ramp.dm).toBeLessThan(ramp.floor);
    // And a frame no term asked for a cut on reports that, rather than
    // letting a branch that clamped to zero take the credit.
    const open = adaptationBranches(loneBodyStatistic(ADAPT_PIN_COVERAGE, 0.5 * L_TARGET));
    expect(open.dm).toBe(0);
    expect(open.regime).toBe('open');
  });

  it('reports the branches the cut was actually computed from', () => {
    const stat = loneBodyStatistic(0.4, BRIGHT);
    const b = adaptationBranches(stat);
    expect(b.eye).toBe(eyeAdaptationDm(stat.meanL));
    expect(b.pin).toBe(surfacePinDm(stat));
    expect(b.floor).toBe(ADAPT_DISPLAY_FLOOR_DM);
    expect(b.discL).toBe(BRIGHT);
    expect(b.coverage).toBe(0.4);
    expect(b.weight).toBe(1);
  });
});

describe('the tuning override (debug panel)', () => {
  it('defaults to the shipped constants', () => {
    expect(DEFAULT_ADAPTATION_TUNING).toEqual({
      lAdapt: L_ADAPT,
      lTarget: L_TARGET,
      whitePoint: tonemapWhitePoint(),
    });
    expect(displayFloorDm()).toBe(ADAPT_DISPLAY_FLOOR_DM);
  });

  it('moves each branch by the level it is measured against', () => {
    const tuning = {
      ...DEFAULT_ADAPTATION_TUNING,
      lAdapt: 2 * L_ADAPT,
      lTarget: 2 * L_TARGET,
    };
    // Doubling a branch's anchor shallows that branch by exactly one stop.
    expect(eyeAdaptationDm(1, tuning.lAdapt))
      .toBeCloseTo(eyeAdaptationDm(1) + MAG_PER_STOP, 12);
    const stat = loneBodyStatistic(0.4, 1e3);
    expect(surfacePinDm(stat, tuning.lTarget))
      .toBeCloseTo(surfacePinDm(stat) + MAG_PER_STOP, 12);
    // The ramp is geometry, not a level, so neither knob moves it.
    expect(adaptationBranches(stat, tuning).weight)
      .toBe(adaptationBranches(stat).weight);
  });

  // The floor is derived from the white point, so DR_MAG has to reach it.
  // A wider range is a brighter full-white frame, which JUSTIFIES a deeper
  // cut — so sweeping DR_MAG to 11 sinks the floor 3.5 mag and unbinds the
  // perception branch that far. Left on the default constant, a swept build
  // would clamp the field to a display range the operator no longer has.
  it('tracks a swept DR_MAG through to the display floor', () => {
    const swept = { ...DEFAULT_ADAPTATION_TUNING, whitePoint: tonemapWhitePoint(11) };
    expect(displayFloorDm(swept)).toBeCloseTo(-9.79, 2);
    expect(displayFloorDm(swept) - ADAPT_DISPLAY_FLOOR_DM).toBeCloseTo(-3.5, 1);
    // One frame, floor-bound either way, 3.5 mag apart in what it applies.
    const floorBound = loneBodyStatistic(3e-3, 3.6e5);
    expect(adaptationBranches(floorBound).regime).toBe('floor');
    expect(adaptationBranches(floorBound).dm).toBe(ADAPT_DISPLAY_FLOOR_DM);
    const b = adaptationBranches(floorBound, swept);
    expect(b.regime).toBe('floor');
    expect(b.dm).toBe(displayFloorDm(swept));
  });
});

describe('coverage sensitivity (§ 3.2)', () => {
  /** Dim enough that the display floor never binds at these coverages, so
   *  the perception branch's geometry is what these rows exercise. */
  const DIM_DISC_L = 100;
  /** Venus-class — bright enough that the floor binds everywhere under
   *  the ramp. */
  const BRIGHT_DISC_L = 3.57e5;

  it('lands the reference coverage on L_TARGET through both branches', () => {
    // The two agree there by construction, which is why the ramp's top can
    // be the park framing and close with no step.
    expect(L_ADAPT / ADAPT_REF_COVERAGE).toBeCloseTo(L_TARGET, 12);
    const stat = loneBodyStatistic(ADAPT_REF_COVERAGE, BRIGHT_DISC_L);
    expect(surfacePinDm(stat)).toBeCloseTo(eyeAdaptationDm(stat.meanL), 9);
    expect(adaptedDiscMeanL(ADAPT_REF_COVERAGE, BRIGHT_DISC_L)).toBeCloseTo(L_TARGET, 9);
    expect(trimStopsForCoverage(ADAPT_REF_COVERAGE, BRIGHT_DISC_L)).toBeCloseTo(0, 9);
  });

  it('drifts by the coverage ratio under the ramp, and is flat over it', () => {
    // Under the ramp's foot the perception branch governs alone and the
    // trim buys back log2(f/f_ref), exactly as it always did.
    expect(trimStopsForCoverage(0.5 * ADAPT_DOT_COVERAGE, DIM_DISC_L)).toBeCloseTo(-4, 9);
    // ±3 stops = a factor 8 in coverage, so the envelope the trim can pull
    // back to L_TARGET ends exactly at the ramp's foot.
    expect(trimStopsForCoverage(ADAPT_DOT_COVERAGE, DIM_DISC_L))
      .toBeCloseTo(-EV_MAX_STOPS, 9);
    // Over the ramp the pin holds the level, so the body needs no trim
    // however much of the frame it fills.
    for (const f of [ADAPT_PIN_COVERAGE, 0.3, 0.9]) {
      expect(trimStopsForCoverage(f, DIM_DISC_L)).toBeCloseTo(0, 12);
    }
  });

  it('brings a bright disc under the ramp back inside the trim range', () => {
    // The floor still caps a below-ramp frame, so a Venus-class surface at
    // half park stays over the white point — but the ramp has already taken
    // most of the pin's depth, so the residual is inside the ±3 stops the
    // trim has, where the guard-era model left it at 6.02 stops out.
    const meanAtHalfPark = adaptedDiscMeanL(0.5 * ADAPT_REF_COVERAGE, BRIGHT_DISC_L);
    expect(meanAtHalfPark).toBeCloseTo(5.62, 2);
    const trimNeeded = trimStopsForCoverage(0.5 * ADAPT_REF_COVERAGE, BRIGHT_DISC_L);
    expect(trimNeeded).toBeCloseTo(-2.66, 2);
    expect(trimNeeded).toBeGreaterThan(-EV_MAX_STOPS);
  });
});
