import { describe, it, expect } from 'vitest';
import {
  apparentMagnitude,
  bodySurfaceBrightnessMagArcsec2,
  hostIrradianceMagnitude,
  perceptualDmEff,
  perceptualAppSizePx,
  planetApparentMagnitude,
} from './perceptual-magnitude';
import { MOON_PHASE, lambertianPhaseFactor, mallamaPhaseFactor } from './phase-function';
import { ARCSEC_TO_RAD, AU_PC, KM_PC, SUN_ABSMAG_V } from '../util/astronomy-constants';

describe('apparentMagnitude', () => {
  it('returns the absolute magnitude at 10 pc by definition', () => {
    expect(apparentMagnitude(0, 10)).toBeCloseTo(0, 12);
    expect(apparentMagnitude(4.83, 10)).toBeCloseTo(4.83, 12); // Sol
  });

  it('adds 5 mag per decade of distance', () => {
    expect(apparentMagnitude(0, 100)).toBeCloseTo(5, 12);
    expect(apparentMagnitude(0, 1000)).toBeCloseTo(10, 12);
  });

  it('subtracts 5 mag per decade closer than 10 pc', () => {
    expect(apparentMagnitude(0, 1)).toBeCloseTo(-5, 12);
  });

  it('lands Sol from Earth at the textbook value', () => {
    // 1 AU = 4.8481368e-6 pc
    const m = apparentMagnitude(4.83, 4.8481368e-6);
    expect(m).toBeCloseTo(-26.74, 1);
  });

  it('does not divide by zero at d = 0', () => {
    expect(Number.isFinite(apparentMagnitude(0, 0))).toBe(true);
  });
});

describe('perceptualDmEff', () => {
  // 'all' preset values — sizeSpan=17, knee=16 from STAR_RENDER_DEFAULTS.
  const SPAN = 17;
  const KNEE = 16;
  const CUTOFF = 15;

  it('returns 0 at the visibility cutoff', () => {
    expect(perceptualDmEff(CUTOFF, CUTOFF, SPAN, KNEE)).toBe(0);
  });

  it('clamps to 0 for sources fainter than the cutoff', () => {
    expect(perceptualDmEff(CUTOFF + 1, CUTOFF, SPAN, KNEE)).toBe(0);
    expect(perceptualDmEff(20, CUTOFF, SPAN, KNEE)).toBe(0);
  });

  it('is identity inside the linear region (dM ≤ sizeSpan)', () => {
    // appMag = 0 → dM = 15; dM ≤ sizeSpan=17 → identity.
    expect(perceptualDmEff(0, CUTOFF, SPAN, KNEE)).toBeCloseTo(15, 12);
    // appMag = -2 (Sirius-bright) → dM = 17 → exactly the boundary.
    expect(perceptualDmEff(-2, CUTOFF, SPAN, KNEE)).toBeCloseTo(17, 12);
  });

  it('asymptotes to (sizeSpan + sizeKnee) for super-bright sources', () => {
    // appMag = -1000 → dM = 1015. Asymptote = 17 + 16 = 33.
    const v = perceptualDmEff(-1000, CUTOFF, SPAN, KNEE);
    expect(v).toBeLessThan(SPAN + KNEE);
    expect(v).toBeGreaterThan(SPAN + KNEE - 0.5); // close to asymptote
  });

  it('continuous across the dM = sizeSpan boundary', () => {
    // ε on either side of the knee transition should produce nearly-
    // equal outputs (the formula is C0 by construction).
    const eps = 1e-9;
    const below = perceptualDmEff(CUTOFF - SPAN + eps, CUTOFF, SPAN, KNEE);
    const above = perceptualDmEff(CUTOFF - SPAN - eps, CUTOFF, SPAN, KNEE);
    expect(Math.abs(above - below)).toBeLessThan(1e-6);
  });

  it('sizeKnee = 0 hard-clamps at sizeSpan (legacy behaviour)', () => {
    // Above the knee, with knee=0, the bend collapses to a flat ceiling.
    expect(perceptualDmEff(-1000, CUTOFF, SPAN, 0)).toBeCloseTo(SPAN, 12);
  });
});

describe('perceptualAppSizePx', () => {
  it('returns sizeMin at dMEff = 0', () => {
    expect(perceptualAppSizePx(0, 2, 24, 17)).toBeCloseTo(2, 12);
  });

  it('returns sizeMax at dMEff = sizeSpan', () => {
    expect(perceptualAppSizePx(17, 2, 24, 17)).toBeCloseTo(24, 12);
  });

  it('halfway in dMEff lands at sqrt(0.5) blend (= ~70.7%)', () => {
    // dMEff/span = 0.5 → t = sqrt(0.5) ≈ 0.707 → ~17.6 between [2, 24].
    const v = perceptualAppSizePx(8.5, 2, 24, 17);
    const expected = 2 + Math.sqrt(0.5) * (24 - 2);
    expect(v).toBeCloseTo(expected, 12);
  });

  it('is monotone increasing in dMEff', () => {
    let prev = -Infinity;
    for (let dMEff = 0; dMEff <= 30; dMEff += 0.5) {
      const v = perceptualAppSizePx(dMEff, 2, 24, 17);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('keeps Sol-vs-Canopus ratio meaningful with a non-zero knee', () => {
    // Two sources both bright enough to clear the linear ceiling
    // (dM > sizeSpan = 17 → both above the knee). With knee=0 they
    // hard-clamp to the same dMEff and render at the same disc size;
    // with knee>0 the brighter one stays meaningfully larger.
    const SPAN = 17;
    const KNEE = 16;
    // Canopus appMag ≈ -5 → dM = 20; Sol close-approach appMag ≈ -26
    // → dM = 41. Both above SPAN.
    const solSoft = perceptualAppSizePx(
      perceptualDmEff(-26, 15, SPAN, KNEE), 2, 24, SPAN);
    const canSoft = perceptualAppSizePx(
      perceptualDmEff(-5, 15, SPAN, KNEE), 2, 24, SPAN);
    expect(solSoft).toBeGreaterThan(canSoft + 0.5); // visibly different
    // Hard-clamp variant (knee=0) collapses the difference — both
    // hit the same dMEff = sizeSpan and therefore the same appSize.
    const solHard = perceptualAppSizePx(
      perceptualDmEff(-26, 15, SPAN, 0), 2, 24, SPAN);
    const canHard = perceptualAppSizePx(
      perceptualDmEff(-5, 15, SPAN, 0), 2, 24, SPAN);
    expect(Math.abs(solHard - canHard)).toBeLessThan(1e-9);
  });
});

describe('planetApparentMagnitude', () => {
  // Jupiter (R = 69,911 km, geometric albedo p = 0.538) at full phase
  // φ(0) = 1. Reference points are the same three the GLSL shader was
  // hand-verified against.
  const JUPITER_RADIUS_PC = 69911 / 3.0857e13; // km → pc
  const JUPITER_ALBEDO = 0.538;

  it('returns m_host_at_planet when reflectance product = 1', () => {
    // Construct geometry such that the reflected-light correction is
    // zero: albedo·(R/d_vp)²·φ = 1.
    const m = planetApparentMagnitude(0, 1, 10, 1, 1, 1);
    expect(m).toBeCloseTo(0, 12); // hostAbsmag=0 at d_hp=10pc, refl=1 → 0
  });

  it('Jupiter from Earth at opposition: ≈ -2.7 V', () => {
    // d_hp = 5.2 AU, d_vp = 4.2 AU, φ ≈ 1.
    const m = planetApparentMagnitude(
      SUN_ABSMAG_V,
      4.2 * AU_PC, 5.2 * AU_PC,
      JUPITER_ALBEDO, JUPITER_RADIUS_PC, 1,
    );
    expect(m).toBeCloseTo(-2.7, 1);
  });

  it('Jupiter from outside the heliopause (150 AU upwind): ≈ +5.2 V', () => {
    // Viewer 150 AU upwind from Sol along Sol→Jupiter line. Jupiter at
    // 5.2 AU on the same line ⇒ d_vp = 144.8 AU.
    const m = planetApparentMagnitude(
      SUN_ABSMAG_V,
      144.8 * AU_PC, 5.2 * AU_PC,
      JUPITER_ALBEDO, JUPITER_RADIUS_PC, 1,
    );
    expect(m).toBeCloseTo(5.2, 0);
  });

  it('Jupiter from α Cen (1.34 pc, Sol→Jupiter colinear with viewer): ≈ +21 V', () => {
    // Distance from α Cen to Sol is 1.34 pc; Jupiter is 5.2 AU from Sol
    // — negligible against 1.34 pc, so d_vh ≈ d_vp.
    const dVp = 1.34 - 5.2 * AU_PC;
    const m = planetApparentMagnitude(
      SUN_ABSMAG_V, dVp, 5.2 * AU_PC,
      JUPITER_ALBEDO, JUPITER_RADIUS_PC, 1,
    );
    expect(m).toBeCloseTo(21, 0);
  });

  it('halving albedo dims the planet by 2.5·log10(2) ≈ 0.753 mag', () => {
    const m1 = planetApparentMagnitude(
      0, 1, 10, 1, 1, 1,
    );
    const m2 = planetApparentMagnitude(
      0, 1, 10, 0.5, 1, 1,
    );
    expect(m2 - m1).toBeCloseTo(2.5 * Math.log10(2), 12);
  });

  it('halving the phase factor dims the planet by 2.5·log10(2) mag', () => {
    const m1 = planetApparentMagnitude(
      0, 1, 10, 1, 1, 1,
    );
    const m2 = planetApparentMagnitude(
      0, 1, 10, 1, 1, 0.5,
    );
    expect(m2 - m1).toBeCloseTo(2.5 * Math.log10(2), 12);
  });

  it('zero phase factor floors at the 1e-30 clamp (finite, not -Inf)', () => {
    const m = planetApparentMagnitude(0, 1, 10, 1, 1, 0);
    expect(Number.isFinite(m)).toBe(true);
  });

  it('viewer exactly at the host (observe mode): finite and equal to the near-host limit', () => {
    // Observe parks the camera at the host's exact position, so the
    // formula must not involve the viewer→host distance at all. Jupiter
    // seen from Sol itself: d_vp = d_hp = 5.2 AU, full phase.
    const atHost = planetApparentMagnitude(
      SUN_ABSMAG_V, 5.2 * AU_PC, 5.2 * AU_PC,
      JUPITER_ALBEDO, JUPITER_RADIUS_PC, 1,
    );
    expect(Number.isFinite(atHost)).toBe(true);
    // Brighter than from Earth at opposition (closer to the planet is
    // farther in this colinear setup — from Sol, d_vp 5.2 vs 4.2 AU).
    expect(atHost).toBeCloseTo(-2.3, 1);
  });

  it('does not divide by zero at d_vp = 0', () => {
    const m = planetApparentMagnitude(0, 0, 10, 0.5, 1, 1);
    expect(Number.isFinite(m)).toBe(true);
  });

  it('nails the full Moon at −12.7 — the absolute-flux calibration anchor', () => {
    // The formula has NO free constant; it lands on the standard V-mag
    // scale from M_host + physical p/R/distances alone. Full Moon from
    // Earth is the canonical check: Sun (M=4.83) at d_hp=1 AU, viewer at
    // d_vp=384,400 km, R=1737.4 km, geometric albedo p=0.12, φ(0)=1.
    // Real full-Moon V ≈ −12.74. Agreement here proves the inverse-square
    // flux is correctly calibrated, and (being anchored on M_host) it
    // flows to any host star for free.
    const m = planetApparentMagnitude(
      SUN_ABSMAG_V,
      384_400 * KM_PC,
      AU_PC,
      0.12,
      1737.4 * KM_PC,
      1,
    );
    expect(m).toBeCloseTo(-12.7, 1);
  });

  it('the Moon runs the whole lunation on its own curve, anchor untouched', () => {
    // End-to-end through MOON_PHASE rather than a hand-passed φ: the
    // −12.74 anchor survives because the law has c0 = 0, and the half
    // Moon lands 1.36 mag fainter than the Lambert sphere it used to
    // render as.
    const moonMag = (phi: number): number => planetApparentMagnitude(
      SUN_ABSMAG_V, 384_400 * KM_PC, AU_PC, 0.12, 1737.4 * KM_PC, phi,
    );
    expect(moonMag(mallamaPhaseFactor(MOON_PHASE, 0))).toBeCloseTo(-12.7, 1);

    const half = Math.PI / 2;
    const onCurve = moonMag(mallamaPhaseFactor(MOON_PHASE, half));
    const onLambert = moonMag(lambertianPhaseFactor(half));
    expect(onCurve - onLambert).toBeCloseTo(1.36, 2);
  });
});

describe('hostIrradianceMagnitude', () => {
  it('puts Sol at 1 AU at its known apparent magnitude', () => {
    expect(hostIrradianceMagnitude(SUN_ABSMAG_V, AU_PC)).toBeCloseTo(-26.74, 2);
  });

  it('is the distance modulus: 5 mag per decade of host distance', () => {
    expect(
      hostIrradianceMagnitude(SUN_ABSMAG_V, 10 * AU_PC)
        - hostIrradianceMagnitude(SUN_ABSMAG_V, AU_PC),
    ).toBeCloseTo(5, 9);
  });

  it('trades luminosity against distance — equal irradiance is equal magnitude', () => {
    // A host 5 mag fainter at 10x closer delivers the same irradiance, which
    // is what makes everything derived from it general across systems rather
    // than anchored to Sol.
    expect(hostIrradianceMagnitude(SUN_ABSMAG_V + 5, AU_PC)).toBeCloseTo(
      hostIrradianceMagnitude(SUN_ABSMAG_V, 10 * AU_PC), 9);
  });
});

describe('bodySurfaceBrightnessMagArcsec2', () => {
  it('matches the measured full-Moon surface brightness', () => {
    // The independent half of the -12.7 flux anchor above: 3.4 mag/arcsec2 is
    // the measured value, and it follows from the same p and irradiance with
    // no free constant.
    expect(bodySurfaceBrightnessMagArcsec2(SUN_ABSMAG_V, AU_PC, 0.12))
      .toBeCloseTo(3.4, 1);
  });

  it('equals flux spread over the disc, at any radius and viewer distance', () => {
    // The closed form drops radius and viewer distance because they cancel in
    // m + 2.5·log10(Ω_disc). Deriving it the long way from
    // planetApparentMagnitude proves the cancellation rather than assuming it:
    // a body brightening per-pixel on approach is exactly the failure the old
    // display compression existed to hide.
    const albedo = 0.12;
    const closed = bodySurfaceBrightnessMagArcsec2(SUN_ABSMAG_V, AU_PC, albedo);
    for (const radiusPc of [1737.4 * KM_PC, 69911 * KM_PC]) {
      for (const dVpPc of [0.001 * AU_PC, AU_PC, 40 * AU_PC]) {
        const m = planetApparentMagnitude(
          SUN_ABSMAG_V, dVpPc, AU_PC, albedo, radiusPc, 1,
        );
        const rhoArcsec = radiusPc / dVpPc / ARCSEC_TO_RAD;
        const viaFlux = m + 2.5 * Math.log10(Math.PI * rhoArcsec * rhoArcsec);
        expect(viaFlux).toBeCloseTo(closed, 9);
      }
    }
  });

  it('tracks albedo as -2.5·log10(p): a 10x darker surface is 2.5 mag fainter', () => {
    expect(
      bodySurfaceBrightnessMagArcsec2(SUN_ABSMAG_V, AU_PC, 0.06)
        - bodySurfaceBrightnessMagArcsec2(SUN_ABSMAG_V, AU_PC, 0.6),
    ).toBeCloseTo(2.5, 9);
  });

  it('brightens with irradiance one-for-one — Mercury over Neptune', () => {
    // Now the full 1/d^2 range (~4.8 mag Mercury->Neptune) rather than the
    // quarter-power compression the tone-map replaced.
    const mercury = bodySurfaceBrightnessMagArcsec2(SUN_ABSMAG_V, 0.387 * AU_PC, 0.142);
    const neptune = bodySurfaceBrightnessMagArcsec2(SUN_ABSMAG_V, 30.069 * AU_PC, 0.442);
    expect(neptune - mercury).toBeGreaterThan(8);
  });

  it('scales with host luminosity by star class alone', () => {
    const sol5 = bodySurfaceBrightnessMagArcsec2(SUN_ABSMAG_V, 5 * AU_PC, 0.3);
    const bright5 = bodySurfaceBrightnessMagArcsec2(SUN_ABSMAG_V - 5, 5 * AU_PC, 0.3);
    expect(sol5 - bright5).toBeCloseTo(5, 9);
  });
});
