import { describe, it, expect } from 'vitest';
import {
  hostIrradianceLuminance,
  lambertLimbDiscMean,
  LIMB_EXP,
  LIMB_FLOOR,
  meshSurfaceLuminance,
} from './mesh-surface-pure';
import {
  bodySurfaceBrightnessMagArcsec2,
  planetApparentMagnitude,
} from '../perceptual-magnitude';
import { LUMA_CEIL, pointSourcePeakLuminance, surfaceBrightnessLuminance } from '../../hdr/emission-pure';
import { BASE_EPOCH_EXPOSURE } from '../../hdr/exposure/exposure-epoch';
import { ARCSEC_TO_RAD, AU_PC, KM_PC, SUN_ABSMAG_V } from '../../util/astronomy-constants';
import meshFrag from './planet-mesh.frag.glsl?raw';

/** Numerical disc average of the shader's shading, area-weighted over the
 *  projected disc at full phase — the independent check on the closed form. */
function numericDiscMean(limbFloor: number, limbExp: number): number {
  const steps = 200000;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const rho = (i + 0.5) / steps;
    const mu = Math.sqrt(1 - rho * rho);
    const limb = limbFloor + (1 - limbFloor) * mu ** limbExp;
    sum += mu * limb * 2 * rho * (1 / steps);
  }
  return sum;
}

describe('lambertLimbDiscMean', () => {
  it('is pure Lambert 2/3 with no limb darkening', () => {
    expect(lambertLimbDiscMean(1, LIMB_EXP)).toBeCloseTo(2 / 3, 12);
  });

  it('matches a numerical disc integral of the shipped limb law', () => {
    expect(lambertLimbDiscMean(LIMB_FLOOR, LIMB_EXP))
      .toBeCloseTo(numericDiscMean(LIMB_FLOOR, LIMB_EXP), 5);
  });

  it('darkens the disc — limb darkening removes light before normalisation', () => {
    expect(lambertLimbDiscMean(LIMB_FLOOR, LIMB_EXP)).toBeLessThan(2 / 3);
  });
});

describe('planet-mesh.frag.glsl limb constants', () => {
  it('mirrors LIMB_FLOOR / LIMB_EXP — the disc-mean normaliser depends on them', () => {
    expect(meshFrag).toContain(`const float LIMB_FLOOR = ${LIMB_FLOOR};`);
    expect(meshFrag).toContain(`const float LIMB_EXP = ${LIMB_EXP};`);
  });
});

describe('hostIrradianceLuminance', () => {
  const omegaPx = 8836; // ~94 arcsec/px, the § 1 band reference pixel

  it('falls as 1/d² in host distance', () => {
    const at1 = hostIrradianceLuminance(BASE_EPOCH_EXPOSURE, omegaPx, SUN_ABSMAG_V, AU_PC);
    const at10 = hostIrradianceLuminance(BASE_EPOCH_EXPOSURE, omegaPx, SUN_ABSMAG_V, 10 * AU_PC);
    expect(at1 / at10).toBeCloseTo(100, 6);
  });

  it('scales linearly with exposure and with pixel solid angle', () => {
    const base = hostIrradianceLuminance(1, omegaPx, SUN_ABSMAG_V, AU_PC);
    expect(hostIrradianceLuminance(3, omegaPx, SUN_ABSMAG_V, AU_PC)).toBeCloseTo(3 * base, 6);
    expect(hostIrradianceLuminance(1, 2 * omegaPx, SUN_ABSMAG_V, AU_PC))
      .toBeCloseTo(2 * base, 6);
  });

  it('is the unit-albedo Lambertian surface: π× a p=1 disc mean', () => {
    const s = bodySurfaceBrightnessMagArcsec2(SUN_ABSMAG_V, AU_PC, 1);
    expect(hostIrradianceLuminance(BASE_EPOCH_EXPOSURE, omegaPx, SUN_ABSMAG_V, AU_PC))
      .toBeCloseTo(Math.PI * surfaceBrightnessLuminance(BASE_EPOCH_EXPOSURE, s, omegaPx), 6);
  });
});

describe('meshSurfaceLuminance', () => {
  const omegaPx = 8836;
  const moon = { albedo: 0.12, radiusPc: 1737.4 * KM_PC };

  it('renormalises so the shaded disc integrates back to the mean', () => {
    // The scalar the shader multiplies, times the disc mean of everything it
    // multiplies on top, must return the body's true mean surface luminance.
    // This is the whole contract — a wrong normaliser puts every body off its
    // flux with no other symptom.
    const baseMean = 0.25;
    const scalar = meshSurfaceLuminance(
      BASE_EPOCH_EXPOSURE, omegaPx, SUN_ABSMAG_V, AU_PC, moon.albedo, baseMean, false,
    );
    const shadingMean = lambertLimbDiscMean(LIMB_FLOOR, LIMB_EXP);
    const meanL = surfaceBrightnessLuminance(
      BASE_EPOCH_EXPOSURE,
      bodySurfaceBrightnessMagArcsec2(SUN_ABSMAG_V, AU_PC, moon.albedo),
      omegaPx,
    );
    expect(scalar * shadingMean * baseMean).toBeCloseTo(meanL, 12);
  });

  it('is continuous with the glare point-source rule on a resolved disc', () => {
    // The resolve step. Past 1 px the glare emits L(m)/(π·r²) — the disc's
    // mean surface brightness — and the mesh emits the same quantity, so a
    // body crossing the handoff does not jump. Both sides are built from the
    // same p and irradiance, which is what makes this hold rather than tune.
    const dVpPc = 0.002 * AU_PC;
    // A narrower plate scale than the § 1 band reference: continuity is a
    // claim about the PRE-clamp quantity, and the glare side clamps at
    // LUMA_CEIL while the mesh scalar does not — at 94 arcsec/px the
    // full-Moon disc already sits above the ceiling.
    const omegaPxUnclipped = omegaPx / 4;
    const pxPerRad = 1 / (ARCSEC_TO_RAD * Math.sqrt(omegaPxUnclipped));
    const rPhysPx = (moon.radiusPc / dVpPc) * pxPerRad;
    expect(rPhysPx).toBeGreaterThan(1);

    const m = planetApparentMagnitude(
      SUN_ABSMAG_V, dVpPc, AU_PC, moon.albedo, moon.radiusPc, 1,
    );
    const glarePeak = pointSourcePeakLuminance(BASE_EPOCH_EXPOSURE, m, rPhysPx);
    expect(glarePeak).toBeLessThan(LUMA_CEIL);
    const meshMean = meshSurfaceLuminance(
      BASE_EPOCH_EXPOSURE, omegaPxUnclipped, SUN_ABSMAG_V, AU_PC, moon.albedo, 1, false,
    ) * lambertLimbDiscMean(LIMB_FLOOR, LIMB_EXP);

    // Relative, not absolute: the two sides reach the same number through
    // different log/pow round-trips, so they agree to float64 epsilon rather
    // than bit-exactly. A real calibration break is orders of magnitude, not
    // parts in 1e15.
    expect(Math.abs(meshMean / glarePeak - 1)).toBeLessThan(1e-12);
  });

  it('divides out the map mean, so a stretched mosaic changes nothing', () => {
    // A brighter map only means a smaller scalar: the product the shader
    // emits is invariant, which is what makes the texture arriving
    // mid-approach flux-neutral instead of a brightness pop.
    const dim = meshSurfaceLuminance(
      BASE_EPOCH_EXPOSURE, omegaPx, SUN_ABSMAG_V, AU_PC, moon.albedo, 0.1, false,
    );
    const bright = meshSurfaceLuminance(
      BASE_EPOCH_EXPOSURE, omegaPx, SUN_ABSMAG_V, AU_PC, moon.albedo, 0.4, false,
    );
    expect(dim * 0.1).toBeCloseTo(bright * 0.4, 12);
  });

  it('sits exactly p/π below the airlight scalar — so the airlight needs no gain', () => {
    // The two scalars an atmospheric body's shader multiplies differ by the
    // body's Lambert reflectance and nothing else: the surface emits
    // A·μ/π·E·Ω with A = 1.5p, the airlight emits (∫β·P·T dl)·E·Ω. Both are
    // already the physical radiance, which is why the single-scatter
    // integrator's output is complete as it stands and any overall airlight
    // gain is a display fudge on a calibrated quantity.
    const baseMean = 0.25;
    const albedo = 0.43;
    const surface = meshSurfaceLuminance(
      BASE_EPOCH_EXPOSURE, omegaPx, SUN_ABSMAG_V, AU_PC, albedo, baseMean, true,
    );
    const airlight = hostIrradianceLuminance(
      BASE_EPOCH_EXPOSURE, omegaPx, SUN_ABSMAG_V, AU_PC,
    );
    expect((surface * baseMean * (2 / 3)) / airlight).toBeCloseTo(albedo / Math.PI, 12);
  });

  it('uses the pure-Lambert mean for atmospheric bodies (no limb term)', () => {
    const airless = meshSurfaceLuminance(
      BASE_EPOCH_EXPOSURE, omegaPx, SUN_ABSMAG_V, AU_PC, 0.3, 1, false,
    );
    const atmospheric = meshSurfaceLuminance(
      BASE_EPOCH_EXPOSURE, omegaPx, SUN_ABSMAG_V, AU_PC, 0.3, 1, true,
    );
    expect(airless / atmospheric)
      .toBeCloseTo((2 / 3) / lambertLimbDiscMean(LIMB_FLOOR, LIMB_EXP), 12);
  });
});
