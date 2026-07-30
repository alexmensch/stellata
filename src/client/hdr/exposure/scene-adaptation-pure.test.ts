import { describe, expect, it } from 'vitest';
import { angularToPx } from '../../camera/controls/star-geometry';
import { PLANET_PARK_FILL_FRACTION } from '../../camera/controls/star-physics';
import { ARCSEC_TO_RAD } from '../../util/astronomy-constants';
import {
  luminanceForMagnitude,
  pixelSolidAngleArcsec2,
  surfaceBrightnessLuminance,
} from '../emission-pure';
import { EV_MAX_STOPS, exposureForMagLimit, MAG_PER_STOP } from './exposure-epoch';
import { tonemapWhitePoint } from '../tonemap-pure';
import {
  ADAPT_EDGE_RAMP_PX,
  ADAPT_NEGLIGIBLE_FRACTION,
  ADAPT_REF_COVERAGE,
  ADAPT_STAR_ABSMAG_REF,
  adaptationDm,
  adaptedDiscMeanL,
  eyeAdaptationDm,
  guardHandoverCoverage,
  highlightGuardDm,
  DIFFUSE_FIELD_L,
  discViewportOverlapArea,
  footprintRadiusPx,
  L_ADAPT,
  L_CAP,
  L_TARGET,
  type LuminanceSample,
  meanSceneLuminance,
  negligibleAppMag,
  sampleFluxL,
  samplePeakL,
  sampleVisibleFraction,
  sourceVisibleFraction,
  starAdaptationWindowPc,
  starSourceKey,
  trimStopsForCoverage,
  visibilityDiscRadiusPx,
  windowTaper,
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

function sample(patch: Partial<LuminanceSample>): LuminanceSample {
  return {
    appMag: 0,
    diameterPx: 0,
    screenX: 0.5 * VIEWPORT_W,
    screenY: 0.5 * VIEWPORT_H,
    cameraDistancePc: 1,
    fluxScale: 1,
    sourceKey: 0,
    label: null,
    ...patch,
  };
}

/** One unoccluded source's share of the frame's mean luminance. */
function contribution(s: LuminanceSample): number {
  const visible = sampleVisibleFraction(s, 1, VIEWPORT_W, VIEWPORT_H);
  return sampleFluxL(s, EXPOSURE, visible) / VIEWPORT_AREA_PX;
}

describe('scene-adaptation constants', () => {
  it('pins the measured target and the anchor derived from it', () => {
    expect(L_TARGET).toBe(0.89);
    expect(ADAPT_REF_COVERAGE).toBe(0.0685);
    expect(L_ADAPT).toBeCloseTo(0.060965, 12);
    expect(L_CAP).toBe(1.2);
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

  it('builds the diffuse field from one frame of sky, not the whole sky', () => {
    // A 50° frame is a tenth of the sphere, so the whole-sky
    // threshold-star population is an order of magnitude too many for it.
    expect(FRAME_SKY_FRACTION).toBeCloseTo(0.1077, 4);
    const thresholdStars =
      (1e5 * FRAME_SKY_FRACTION * THRESHOLD_STAR_L) / VIEWPORT_AREA_PX;
    // The band's anticentre-plane surface brightness (milkyway/README.md's
    // gradient: GC 20.0, anticentre plane 22.55, NGP 25.08).
    const milkyWayBand = surfaceBrightnessLuminance(EXPOSURE, 22.55, OMEGA_PX);
    expect(thresholdStars).toBeCloseTo(1.04e-4, 5);
    expect(milkyWayBand).toBeCloseTo(7.0e-4, 5);
    expect(milkyWayBand / thresholdStars).toBeCloseTo(6.7, 1);
    expect(DIFFUSE_FIELD_L).toBeCloseTo(thresholdStars + milkyWayBand, 5);
    // Inert by construction: it can never reach the anchor on its own.
    expect(DIFFUSE_FIELD_L * 50).toBeLessThan(L_ADAPT);
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
    const diameterPx = 2 * Math.sqrt((coverage * VIEWPORT_AREA_PX) / Math.PI);
    const appMag = -2.5 * Math.log10((surfaceL * coverage * VIEWPORT_AREA_PX) / EXPOSURE);
    expect(contribution(sample({ appMag, diameterPx }))).toBeCloseTo(7.1e4, -3);
    expect(eyeAdaptationDm(surfaceL * coverage)).toBeCloseTo(-15.17, 2);
  });

  it('adapts hardest to Sol at 1 AU, and still cannot expose its disc', () => {
    const solDiameterPx = (0.53 * 3600) / (206264.806 / angularToPx(VIEWPORT_H, FOV_Y_RAD));
    expect(solDiameterPx).toBeCloseTo(11.45, 2);
    expect(Math.PI * (0.5 * solDiameterPx) ** 2).toBeCloseTo(103, 0);
    const mean = contribution(sample({ appMag: -26.74, diameterPx: solDiameterPx }));
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
    const venusFromEarth = contribution(sample({ appMag: -4.4 }));
    expect(venusFromEarth).toBeCloseTo(7.3e-4, 5);
    expect(eyeAdaptationDm(meanSceneLuminance(0, VIEWPORT_W, VIEWPORT_H))).toBe(0);
    expect(eyeAdaptationDm(venusFromEarth + DIFFUSE_FIELD_L)).toBe(0);
  });

  it('separates the two regimes by nearly eight decades', () => {
    const mustAdapt = surfaceBrightnessLuminance(EXPOSURE, 0.78, OMEGA_PX) * 0.2;
    const mustNot = contribution(sample({ appMag: -4.4 })) + DIFFUSE_FIELD_L;
    expect(Math.log10(mustAdapt / mustNot)).toBeCloseTo(7.7, 1);
  });
});

describe('dm', () => {
  it('is exactly zero on an empty dark frame', () => {
    expect(eyeAdaptationDm(meanSceneLuminance(0, VIEWPORT_W, VIEWPORT_H))).toBe(0);
    expect(eyeAdaptationDm(0)).toBe(0);
    expect(eyeAdaptationDm(L_ADAPT)).toBe(0);
  });

  it('never goes positive — nothing adapts to see fainter than threshold', () => {
    for (const l of [0, 1e-9, DIFFUSE_FIELD_L, 0.5 * L_ADAPT, L_ADAPT, 1e6]) {
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
    // A body of coverage f: L̄ is its surface brightness × f, its peak is
    // the surface brightness itself. The two cuts agree at the handover
    // whatever that surface brightness is — the threshold is coverage
    // alone, and there is no fade band because the branches are equal.
    for (const surfaceL of [12, 3.6e5, 1.3e12]) {
      expect(eyeAdaptationDm(surfaceL * handover))
        .toBeCloseTo(highlightGuardDm(surfaceL), 9);
      expect(eyeAdaptationDm(surfaceL * handover * 0.999))
        .toBeGreaterThan(highlightGuardDm(surfaceL));
      expect(eyeAdaptationDm(surfaceL * handover * 1.001))
        .toBeLessThan(highlightGuardDm(surfaceL));
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
    const surfaceL = 3.6e5;
    for (const f of [0.1, 0.4, 0.95]) {
      const dm = adaptationDm(surfaceL * f, surfaceL);
      expect(surfaceL * 10 ** (0.4 * dm)).toBeCloseTo(L_CAP, 9);
      expect(adaptedDiscMeanL(f)).toBe(L_CAP);
    }
  });

  it('leaves a point source clipped — it protects surfaces, not points', () => {
    // Sol's disc at 1 AU is 103 px of 2.07e6, far below the handover, so
    // the perception branch governs and § 3.2's accepted exception stands.
    const sol = sample({ appMag: -26.74, diameterPx: 11.45 });
    const peak = samplePeakL(sol, EXPOSURE);
    const meanL = contribution(sol);
    expect(adaptationDm(meanL, peak)).toBe(eyeAdaptationDm(meanL));
    expect(peak * 10 ** (0.4 * eyeAdaptationDm(meanL))).toBeGreaterThan(tonemapWhitePoint());
  });

  it('takes a real flux loss out of the peak too', () => {
    const lit = sample({ appMag: -20, diameterPx: 400 });
    const dimmed = sample({ appMag: -20, diameterPx: 400, fluxScale: 0.1 });
    expect(samplePeakL(dimmed, EXPOSURE)).toBeCloseTo(0.1 * samplePeakL(lit, EXPOSURE), 6);
  });
});

describe('coverage sensitivity (§ 3.2)', () => {
  it('lands the reference coverage on L_TARGET under the perception branch', () => {
    expect(L_ADAPT / ADAPT_REF_COVERAGE).toBeCloseTo(L_TARGET, 12);
    // Park coverage sits ABOVE the handover, though, so what actually
    // happens there is the guard — 0.43 stops over the measured target.
    expect(ADAPT_REF_COVERAGE).toBeGreaterThan(guardHandoverCoverage());
    expect(adaptedDiscMeanL(ADAPT_REF_COVERAGE)).toBe(L_CAP);
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
      expect(trimStopsForCoverage(f)).toBeCloseTo(Math.log2(L_TARGET / L_CAP), 12);
    }
  });
});

describe('visibilityDiscRadiusPx', () => {
  it('is the flux footprint once that clears the edge ramp', () => {
    expect(visibilityDiscRadiusPx(400)).toBe(footprintRadiusPx(400));
  });

  it('widens a sub-ramp source to the ramp, which is what makes the product exact', () => {
    // Frame clipping integrates this disc and the coverage taps spread over
    // it. Two different discs and `clipped × transmission` stops being a
    // fraction of one region: a sub-pixel source inside the ramp band off
    // the frame edge reads clipped > 0 with every tap out of frame, so its
    // occlusion is never evaluated and it keeps all its flux.
    expect(visibilityDiscRadiusPx(0)).toBe(0.5 * ADAPT_EDGE_RAMP_PX);
    expect(visibilityDiscRadiusPx(4)).toBe(0.5 * ADAPT_EDGE_RAMP_PX);
    expect(footprintRadiusPx(0)).toBeLessThan(0.5 * ADAPT_EDGE_RAMP_PX);
  });
});

describe('viewport coverage', () => {
  it('gives a fully on-screen source its whole flux, at any size', () => {
    expect(sourceVisibleFraction(0, 960, 540, VIEWPORT_W, VIEWPORT_H)).toBeCloseTo(1, 12);
    expect(sourceVisibleFraction(400, 960, 540, VIEWPORT_W, VIEWPORT_H)).toBeCloseTo(1, 12);
    const flux = (d: number) => contribution(sample({ appMag: -20, diameterPx: d }));
    expect(flux(400)).toBeCloseTo(flux(4), 6);
  });

  it('drops an off-screen source and halves one on the edge', () => {
    const ramp = 0.5 * ADAPT_EDGE_RAMP_PX;
    expect(sourceVisibleFraction(0, -ramp, 540, VIEWPORT_W, VIEWPORT_H)).toBe(0);
    expect(sourceVisibleFraction(0, 0, 540, VIEWPORT_W, VIEWPORT_H)).toBeCloseTo(0.5, 12);
    expect(sourceVisibleFraction(0, 0, 0, VIEWPORT_W, VIEWPORT_H)).toBeCloseTo(0.25, 12);
  });

  it('ramps a sub-pixel point over the edge band instead of stepping', () => {
    // A point's own 1.1 px footprint would take it 0 → 1 inside one
    // frame's worth of camera jitter; the ramp spreads it over 12 px.
    const at = (cx: number) => sourceVisibleFraction(0, cx, 540, VIEWPORT_W, VIEWPORT_H);
    const ramp = 0.5 * ADAPT_EDGE_RAMP_PX;
    expect(at(-ramp)).toBe(0);
    expect(at(ramp)).toBeCloseTo(1, 12);
    let prev = 0;
    for (let cx = -ramp; cx <= ramp; cx += 0.25) {
      const f = at(cx);
      expect(f).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(f - prev).toBeLessThan(0.05);
      prev = f;
    }
  });

  it('ramps continuously as a disc slides in — no frustum-edge pop', () => {
    const at = (cx: number) => sourceVisibleFraction(200, cx, 540, VIEWPORT_W, VIEWPORT_H);
    let prev = 0;
    for (let cx = -110; cx <= 110; cx += 5) {
      const f = at(cx);
      expect(f).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(f - prev).toBeLessThan(0.06);
      prev = f;
    }
    expect(at(-101)).toBe(0);
    expect(at(101)).toBeCloseTo(1, 12);
  });

  it('reports the surface brightness of a disc larger than the frame', () => {
    // Camera close enough that the body covers everything: L̄ collapses
    // to the disc's own per-pixel luminance.
    const r = 4000;
    const area = discViewportOverlapArea(r, 960, 540, VIEWPORT_W, VIEWPORT_H);
    expect(area).toBeCloseTo(VIEWPORT_AREA_PX, 6);
    const surfaceL = 12.5;
    const appMag = -2.5 * Math.log10((surfaceL * Math.PI * r * r) / EXPOSURE);
    expect(contribution(sample({ appMag, diameterPx: 2 * r }))).toBeCloseTo(surfaceL, 6);
  });

  it('matches a closed-form circle for a rectangle that contains it', () => {
    expect(discViewportOverlapArea(300, 960, 540, VIEWPORT_W, VIEWPORT_H))
      .toBeCloseTo(Math.PI * 300 * 300, 6);
    // A quadrant, from a disc centred on a corner.
    expect(discViewportOverlapArea(300, 0, 0, VIEWPORT_W, VIEWPORT_H))
      .toBeCloseTo(0.25 * Math.PI * 300 * 300, 6);
  });
});

describe('visible fraction', () => {
  it('multiplies frame clipping by the measured throughput', () => {
    // Half the footprint off the left edge, half of the rest let through.
    const edge = sample({ diameterPx: 200, screenX: 0 });
    expect(sampleVisibleFraction(edge, 1, VIEWPORT_W, VIEWPORT_H)).toBeCloseTo(0.5, 6);
    expect(sampleVisibleFraction(edge, 0.5, VIEWPORT_W, VIEWPORT_H)).toBeCloseTo(0.25, 6);
  });

  it('a fully occluded source is invisible however much is in frame', () => {
    const centred = sample({ diameterPx: 200 });
    expect(sampleVisibleFraction(centred, 1, VIEWPORT_W, VIEWPORT_H)).toBeCloseTo(1, 12);
    expect(sampleVisibleFraction(centred, 0, VIEWPORT_W, VIEWPORT_H)).toBe(0);
  });

  it('composes multiplicatively with the eclipse dim', () => {
    // Two independent losses: the eclipse is light the body never
    // received, occlusion is light that never reached the camera.
    const half = sample({ appMag: -20, diameterPx: 200, fluxScale: 0.5 });
    const visible = sampleVisibleFraction(half, 0.5, VIEWPORT_W, VIEWPORT_H);
    expect(visible).toBeCloseTo(0.5, 12);
    const full = luminanceForMagnitude(EXPOSURE, -20);
    expect(sampleFluxL(half, EXPOSURE, visible) / full).toBeCloseTo(0.5 * visible, 12);
  });
});

describe('source keys', () => {
  it('keeps stars out of the bodies\' half of the key space', () => {
    // The coverage measurement lands a frame after the walk, so a collision
    // between a body's flat instance index and a star's would hand one
    // source the other's throughput.
    expect(starSourceKey(0)).toBeLessThan(0);
    expect(starSourceKey(312_000)).toBeLessThan(0);
    expect(starSourceKey(4)).not.toBe(starSourceKey(5));
  });
});

describe('star window', () => {
  it('gates on flux, at the magnitude worth 3% of the anchor', () => {
    const mag = negligibleAppMag(EXPOSURE, VIEWPORT_AREA_PX);
    expect(mag).toBeCloseTo(-5.395, 3);
    const gateFlux = luminanceForMagnitude(EXPOSURE, mag) / VIEWPORT_AREA_PX;
    expect(gateFlux).toBeCloseTo(ADAPT_NEGLIGIBLE_FRACTION * L_ADAPT, 12);
  });

  it('covers every star fainter than the reference absolute magnitude', () => {
    const windowPc = starAdaptationWindowPc(EXPOSURE, VIEWPORT_AREA_PX);
    expect(windowPc).toBeCloseTo(13.21, 2);
    const mag = negligibleAppMag(EXPOSURE, VIEWPORT_AREA_PX);
    // A star of the reference absolute magnitude is exactly negligible at
    // the bound, so anything fainter can never reach the gate from
    // outside the window.
    const appMagAtBound = ADAPT_STAR_ABSMAG_REF + 5 * (Math.log10(windowPc) - 1);
    expect(appMagAtBound).toBeCloseTo(mag, 12);
  });

  it('fades the bound out instead of popping at it', () => {
    const w = 10;
    expect(windowTaper(0, w)).toBe(1);
    expect(windowTaper(7.9, w)).toBe(1);
    expect(windowTaper(w, w)).toBe(0);
    expect(windowTaper(w * 1.5, w)).toBe(0);
    expect(windowTaper(9, w)).toBeCloseTo(0.5, 12);
    let prev = 1;
    for (let d = 7.5; d <= 10.5; d += 0.05) {
      const t = windowTaper(d, w);
      expect(t).toBeLessThanOrEqual(prev + 1e-12);
      prev = t;
    }
  });
});
