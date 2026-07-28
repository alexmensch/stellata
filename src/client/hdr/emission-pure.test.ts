import { describe, expect, it } from 'vitest';
import {
  LUMA_CEIL,
  luminanceForMagnitude,
  pixelSolidAngleArcsec2,
  pointSourcePeakLuminance,
  surfaceBrightnessLuminance,
} from './emission-pure';
import { BASE_EPOCH_EXPOSURE } from './exposure-epoch';
import { angularToPx } from '../camera/controls/star-geometry';
import { DR_MAG, reinhardExtended, tonemapWhitePoint } from './tonemap-pure';
import { DEFAULT_FILTER, instrumentLimitMag } from '../filters/filter-state';

const EYE_LIMIT_MAG = instrumentLimitMag(DEFAULT_FILTER.instrument);

// The § 1 range budget, at the naked-eye epoch. These are the numbers
// H7 validates the star field against, so they are pinned rather than
// bounded.
describe('luminanceForMagnitude at the base epoch', () => {
  const cases: ReadonlyArray<[string, number, number]> = [
    ['threshold star', EYE_LIMIT_MAG, 0.02],
    ['Vega', 0.0, 26.3651],
    ['Sirius', -1.46, 101.1649],
  ];

  it.each(cases)('%s (m=%f) → L=%f', (_name, m, expected) => {
    expect(luminanceForMagnitude(BASE_EPOCH_EXPOSURE, m)).toBeCloseTo(expected, 2);
  });

  it('sends a source DR_MAG brighter than the limit to full white', () => {
    const white = luminanceForMagnitude(BASE_EPOCH_EXPOSURE, EYE_LIMIT_MAG - DR_MAG);
    expect(white).toBeCloseTo(tonemapWhitePoint(), 10);
    expect(reinhardExtended(white, tonemapWhitePoint())).toBeCloseTo(1, 12);
  });
});

describe('pointSourcePeakLuminance', () => {
  it('gives an unresolved source its whole flux at the peak', () => {
    for (const r of [0, 0.1, 0.5, 1 / Math.sqrt(Math.PI)]) {
      expect(pointSourcePeakLuminance(BASE_EPOCH_EXPOSURE, 3, r)).toBeCloseTo(
        luminanceForMagnitude(BASE_EPOCH_EXPOSURE, 3),
        12,
      );
    }
  });

  it('falls to surface brightness once the disc resolves', () => {
    const flux = luminanceForMagnitude(BASE_EPOCH_EXPOSURE, -1);
    expect(pointSourcePeakLuminance(BASE_EPOCH_EXPOSURE, -1, 10)).toBeCloseTo(
      flux / (Math.PI * 100),
      12,
    );
  });

  it('is continuous across the unresolved/resolved crossover', () => {
    const rCrossover = 1 / Math.sqrt(Math.PI);
    const below = pointSourcePeakLuminance(BASE_EPOCH_EXPOSURE, 2, rCrossover - 1e-9);
    const above = pointSourcePeakLuminance(BASE_EPOCH_EXPOSURE, 2, rCrossover + 1e-9);
    expect(above).toBeCloseTo(below, 7);
  });

  it('dims as the inverse square of the resolved radius', () => {
    const near = pointSourcePeakLuminance(BASE_EPOCH_EXPOSURE, -5, 20);
    const far = pointSourcePeakLuminance(BASE_EPOCH_EXPOSURE, -5, 40);
    expect(near / far).toBeCloseTo(4, 9);
  });

  it('clamps at LUMA_CEIL — Sol at 1 AU pins to white', () => {
    expect(pointSourcePeakLuminance(BASE_EPOCH_EXPOSURE, -26.7, 0)).toBe(LUMA_CEIL);
  });

  it('leaves fp16 headroom above the ceiling for additive accumulation', () => {
    const FP16_MAX = 65504;
    expect(FP16_MAX / LUMA_CEIL).toBeGreaterThan(15);
  });
});

const fovYRad = (deg: number) => (deg * Math.PI) / 180;

describe('pixelSolidAngleArcsec2', () => {
  it('is the square of vertical-FOV arcsec over viewport height', () => {
    expect(pixelSolidAngleArcsec2(angularToPx(900, fovYRad(50)))).toBeCloseTo(
      ((50 * 3600) / 900) ** 2,
      6,
    );
  });

  it('shrinks quadratically with FOV — zooming 10x dims an extended source 100x', () => {
    const wide = pixelSolidAngleArcsec2(angularToPx(900, fovYRad(50)));
    const zoomed = pixelSolidAngleArcsec2(angularToPx(900, fovYRad(5)));
    expect(wide / zoomed).toBeCloseTo(100, 6);
  });

  it('is finite at the zero-FOV singularity a transition can pass through', () => {
    expect(Number.isFinite(pixelSolidAngleArcsec2(angularToPx(900, 0)))).toBe(true);
  });
});

// The § 1 range-budget row for the Milky Way band: a 20 mag/arcsec²
// sightline at 94 arcsec/px lands on L ≈ 2.3e-3 at the base epoch.
describe('surfaceBrightnessLuminance', () => {
  it('matches the design gate’s MW band-pixel budget row', () => {
    expect(surfaceBrightnessLuminance(BASE_EPOCH_EXPOSURE, 20, 94 ** 2)).toBeCloseTo(
      2.3296e-3,
      6,
    );
  });

  it('agrees with the explicit per-pixel magnitude it collapses', () => {
    const omega = 94 ** 2;
    const magPx = 20 - 2.5 * Math.log10(omega);
    expect(surfaceBrightnessLuminance(BASE_EPOCH_EXPOSURE, 20, omega)).toBeCloseTo(
      luminanceForMagnitude(BASE_EPOCH_EXPOSURE, magPx),
      12,
    );
  });

  it('is linear in pixel solid angle — surface brightness is the invariant', () => {
    const a = surfaceBrightnessLuminance(BASE_EPOCH_EXPOSURE, 21, 1000);
    const b = surfaceBrightnessLuminance(BASE_EPOCH_EXPOSURE, 21, 4000);
    expect(b / a).toBeCloseTo(4, 12);
  });
});
