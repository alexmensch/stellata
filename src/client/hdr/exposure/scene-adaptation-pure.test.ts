import { describe, expect, it } from 'vitest';
import { angularToPx } from '../../camera/controls/star-geometry';
import { ARCSEC_TO_RAD } from '../../util/astronomy-constants';
import {
  luminanceForMagnitude,
  pixelSolidAngleArcsec2,
  surfaceBrightnessLuminance,
} from '../emission-pure';
import { EV_MAX_STOPS, exposureForMagLimit, MAG_PER_STOP } from './exposure-epoch';
import { tonemapWhitePoint } from '../tonemap-pure';
import {
  ADAPT_NEGLIGIBLE_FRACTION,
  ADAPT_REF_COVERAGE,
  ADAPT_STAR_ABSMAG_REF,
  adaptationDm,
  adaptedDiscMeanL,
  DIFFUSE_FIELD_L,
  discViewportOverlapArea,
  L_ADAPT,
  L_TARGET,
  type LuminanceSample,
  meanSceneLuminance,
  negligibleAppMag,
  POINT_SOURCE_RADIUS_PX,
  sampleFluxL,
  sourceVisibleFraction,
  starAdaptationWindowPc,
  trimStopsForCoverage,
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
    fluxScale: 1,
    label: null,
    ...patch,
  };
}

function contribution(s: LuminanceSample): number {
  return sampleFluxL(s, EXPOSURE, VIEWPORT_W, VIEWPORT_H) / VIEWPORT_AREA_PX;
}

describe('scene-adaptation constants', () => {
  it('pins the measured target and the anchor derived from it', () => {
    expect(L_TARGET).toBe(0.89);
    expect(ADAPT_REF_COVERAGE).toBe(0.15);
    expect(L_ADAPT).toBeCloseTo(0.1335, 12);
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
    expect(adaptationDm(surfaceL * coverage)).toBeCloseTo(-14.32, 2);
  });

  it('adapts hardest to Sol at 1 AU, and still cannot expose its disc', () => {
    const solDiameterPx = (0.53 * 3600) / (206264.806 / angularToPx(VIEWPORT_H, FOV_Y_RAD));
    expect(solDiameterPx).toBeCloseTo(11.45, 2);
    expect(Math.PI * (0.5 * solDiameterPx) ** 2).toBeCloseTo(103, 0);
    const mean = contribution(sample({ appMag: -26.74, diameterPx: solDiameterPx }));
    expect(mean).toBeCloseTo(6.3e5, -4);
    const dm = adaptationDm(mean);
    expect(dm).toBeCloseTo(-16.69, 2);
    // § 3.2's accepted exception. Sol's disc reads −10.59 mag/arcsec², so
    // bringing it under the white point takes −22 mag; adaptation plus a
    // full negative trim reaches −18.9 and the disc stays clipped white.
    const discL = surfaceBrightnessLuminance(EXPOSURE, -10.59, OMEGA_PX);
    const neededCut = -2.5 * Math.log10(discL / tonemapWhitePoint());
    expect(neededCut).toBeCloseTo(-22.0, 1);
    const reach = dm - EV_MAX_STOPS * MAG_PER_STOP;
    expect(reach).toBeCloseTo(-18.94, 2);
    expect(reach - neededCut).toBeCloseTo(3.05, 1);
  });

  it('ignores the cases that must not adapt', () => {
    // Venus from Earth: brilliant, and a third of a pixel wide.
    const venusFromEarth = contribution(sample({ appMag: -4.4 }));
    expect(venusFromEarth).toBeCloseTo(7.3e-4, 5);
    expect(adaptationDm(meanSceneLuminance(0, VIEWPORT_W, VIEWPORT_H))).toBe(0);
    expect(adaptationDm(venusFromEarth + DIFFUSE_FIELD_L)).toBe(0);
  });

  it('separates the two regimes by nearly eight decades', () => {
    const mustAdapt = surfaceBrightnessLuminance(EXPOSURE, 0.78, OMEGA_PX) * 0.2;
    const mustNot = contribution(sample({ appMag: -4.4 })) + DIFFUSE_FIELD_L;
    expect(Math.log10(mustAdapt / mustNot)).toBeCloseTo(7.7, 1);
  });
});

describe('dm', () => {
  it('is exactly zero on an empty dark frame', () => {
    expect(adaptationDm(meanSceneLuminance(0, VIEWPORT_W, VIEWPORT_H))).toBe(0);
    expect(adaptationDm(0)).toBe(0);
    expect(adaptationDm(L_ADAPT)).toBe(0);
  });

  it('never goes positive — nothing adapts to see fainter than threshold', () => {
    for (const l of [0, 1e-9, DIFFUSE_FIELD_L, 0.5 * L_ADAPT, L_ADAPT, 1e6]) {
      expect(adaptationDm(l)).toBeLessThanOrEqual(0);
    }
  });

  it('cuts one magnitude per magnitude of overshoot', () => {
    expect(adaptationDm(L_ADAPT * 10 ** 0.4)).toBeCloseTo(-1, 12);
    expect(adaptationDm(L_ADAPT * 100)).toBeCloseTo(-5, 12);
  });
});

describe('coverage sensitivity (§ 3.2)', () => {
  it('lands the reference coverage exactly on L_TARGET', () => {
    expect(adaptedDiscMeanL(ADAPT_REF_COVERAGE)).toBeCloseTo(L_TARGET, 12);
    expect(trimStopsForCoverage(ADAPT_REF_COVERAGE)).toBe(0);
  });

  it('drifts by the coverage ratio, and the trim spans 8× either way', () => {
    // Half the reference coverage reads one octave (2.26/3 mag) bright.
    expect(trimStopsForCoverage(0.5 * ADAPT_REF_COVERAGE)).toBeCloseTo(-1, 12);
    expect(trimStopsForCoverage(2 * ADAPT_REF_COVERAGE)).toBeCloseTo(1, 12);
    // ±3 stops = ±2.26 mag = a factor 8 in coverage, so the envelope the
    // trim can pull back to L_TARGET starts at 1.9% of the frame.
    const floor = ADAPT_REF_COVERAGE / 2 ** EV_MAX_STOPS;
    expect(floor).toBeCloseTo(0.01875, 5);
    expect(trimStopsForCoverage(floor)).toBeCloseTo(-EV_MAX_STOPS, 12);
    expect(Math.abs(trimStopsForCoverage(0.02))).toBeLessThan(EV_MAX_STOPS);
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
    expect(sourceVisibleFraction(0, -5, 540, VIEWPORT_W, VIEWPORT_H)).toBe(0);
    expect(sourceVisibleFraction(0, 0, 540, VIEWPORT_W, VIEWPORT_H)).toBeCloseTo(0.5, 12);
    expect(sourceVisibleFraction(0, 0, 0, VIEWPORT_W, VIEWPORT_H)).toBeCloseTo(0.25, 12);
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

  it('spreads an unresolved point over exactly one pixel', () => {
    expect(Math.PI * POINT_SOURCE_RADIUS_PX ** 2).toBeCloseTo(1, 12);
  });
});

describe('star window', () => {
  it('gates on flux, at the magnitude worth 3% of the anchor', () => {
    const mag = negligibleAppMag(EXPOSURE, VIEWPORT_AREA_PX);
    expect(mag).toBeCloseTo(-6.246, 3);
    const gateFlux = luminanceForMagnitude(EXPOSURE, mag) / VIEWPORT_AREA_PX;
    expect(gateFlux).toBeCloseTo(ADAPT_NEGLIGIBLE_FRACTION * L_ADAPT, 12);
  });

  it('covers every star fainter than the reference absolute magnitude', () => {
    const windowPc = starAdaptationWindowPc(EXPOSURE, VIEWPORT_AREA_PX);
    expect(windowPc).toBeCloseTo(8.93, 2);
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
