import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MAX_DOWNSAMPLE,
  MAX_KERNEL_REACH_TEXELS,
  TARGET_KERNEL_RADIUS_TEXELS,
  summationDownsample,
  summationMean,
  summationRadiusPx,
  summationWeight,
} from './summation-pure';
import { pixelSolidAngleArcsec2, surfaceBrightnessLuminance } from '../emission/emission-pure';
import {
  BASE_EPOCH_EXPOSURE,
  DEFAULT_SUMMATION_ARCSEC2,
} from '../exposure/exposure-epoch';
import { angularToPx } from '../../camera/controls/star-geometry';
import { FOV_MAX_DEG, FOV_MIN_DEG } from '../../camera/timing';
import { ARCSEC_TO_RAD } from '../../util/astronomy-constants';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

const omegaPxFor = (fovDeg: number, viewportPx: number) =>
  pixelSolidAngleArcsec2(angularToPx(viewportPx, (fovDeg * Math.PI) / 180));

const radiusFor = (fovDeg: number, viewportPx = 900) =>
  summationRadiusPx(DEFAULT_SUMMATION_ARCSEC2, omegaPxFor(fovDeg, viewportPx));

/** The tallest viewport a browser plausibly reports in CSS pixels — an 8K
 *  panel at devicePixelRatio 2. */
const TALLEST_VIEWPORT_CSS_PX = 2160;

/** Ω_px is a CSS solid angle, but the convolution's texels are drawing-buffer
 *  pixels, so `SummationPass` multiplies the radius by the device pixel ratio
 *  before choosing a factor — the ratio is part of this pass's domain even
 *  though it is deliberately absent from the brightness. 2 is the renderer's
 *  existing cap, so it is the worst case rather than a sample. */
const MAX_PIXEL_RATIO = 2;

/** Radius in the units the factor is actually chosen in
 *  (`summation-pass.ts`), which is what every bound below has to be measured
 *  over. */
const bufferRadiusFor = (
  fovDeg: number,
  viewportPx = 900,
  pixelRatio = MAX_PIXEL_RATIO,
) => radiusFor(fovDeg, viewportPx) * pixelRatio;

describe('the summation patch on screen', () => {
  it('is the 13.0 arcmin critical diameter at the reference viewport', () => {
    const arcsecPerPx = (50 * 3600) / 900;
    expect(radiusFor(50) * arcsecPerPx * 2).toBeCloseTo(780.6, 1);
    expect((radiusFor(50) * arcsecPerPx * 2) / 60).toBeCloseTo(13.0, 1);
  });

  // The one quantity in the pass that moves with FOV, and the reason it
  // cannot be a fixed-radius blur. Sub-pixel at the widest field, tens of
  // pixels at the narrowest on a tall display.
  it('spans 0.8 px to 23 CSS px across every reachable viewport', () => {
    expect(radiusFor(FOV_MAX_DEG)).toBeCloseTo(0.81, 2);
    expect(radiusFor(FOV_MIN_DEG)).toBeCloseTo(9.76, 2);
    expect(radiusFor(FOV_MIN_DEG, TALLEST_VIEWPORT_CSS_PX)).toBeCloseTo(23.4, 1);
  });

  // What the factor is chosen from, which is what MAX_DOWNSAMPLE's headroom
  // has to cover: 47 px against the 144 px the constant buys.
  it('reaches 47 drawing-buffer px at the worst case the cap allows', () => {
    expect(bufferRadiusFor(FOV_MIN_DEG, TALLEST_VIEWPORT_CSS_PX)).toBeCloseTo(46.8, 1);
    expect(bufferRadiusFor(FOV_MIN_DEG, TALLEST_VIEWPORT_CSS_PX)).toBeLessThan(
      MAX_DOWNSAMPLE * TARGET_KERNEL_RADIUS_TEXELS,
    );
  });

  it('is finite at the zero-FOV singularity a transition can pass through', () => {
    expect(Number.isFinite(summationRadiusPx(DEFAULT_SUMMATION_ARCSEC2, 0))).toBe(true);
  });
});

describe('the downsample factor that bounds the tap count', () => {
  it('reads the diffuse attachment directly while the patch is small', () => {
    expect(summationDownsample(radiusFor(FOV_MAX_DEG))).toBe(1);
    expect(summationDownsample(radiusFor(50))).toBe(1);
    expect(summationDownsample(radiusFor(FOV_MIN_DEG))).toBe(3);
  });

  // The GLSL loop bound is a constant, so a factor that let the kernel run
  // past it would TRUNCATE the disc — a silently lopsided average, not a
  // compile error. This is the invariant that makes the constant safe.
  it('never lets the kernel reach past the shader’s loop bound', () => {
    let worst = 0;
    for (let radiusPx = 0.05; radiusPx <= MAX_DOWNSAMPLE * 4.5; radiusPx += 0.01) {
      worst = Math.max(worst, radiusPx / summationDownsample(radiusPx));
    }
    // Rounding to the nearest factor is what puts the worst case at 4.5
    // rather than at the 3-texel target.
    expect(worst).toBeCloseTo(4.5, 1);
    expect(worst).toBeLessThan(MAX_KERNEL_REACH_TEXELS - 0.5);
  });

  // Rounding puts the kernel in [3 − 1.5/k, 3 + 1.5/k] texels for factor k,
  // so it is never coarser than 2.25 nor finer than 4.5 once there is
  // anything to downsample — the band the quadrature error of 0.02–0.07 mag
  // is measured over (README.md § The kernel).
  it('keeps the kernel inside the band its accuracy was measured over', () => {
    for (const fovDeg of [FOV_MIN_DEG, 20, 30, 50, 90, FOV_MAX_DEG]) {
      for (const viewport of [900, TALLEST_VIEWPORT_CSS_PX]) {
        for (const pixelRatio of [1, 1.5, MAX_PIXEL_RATIO]) {
          const radiusPx = bufferRadiusFor(fovDeg, viewport, pixelRatio);
          const factor = summationDownsample(radiusPx);
          const texels = radiusPx / factor;
          expect(texels).toBeLessThan(MAX_KERNEL_REACH_TEXELS - 0.5);
          // Below the target the patch is simply smaller than 3 px and there
          // is nothing to downsample — the factor floors at 1.
          if (radiusPx >= TARGET_KERNEL_RADIUS_TEXELS) {
            expect(texels).toBeGreaterThan(TARGET_KERNEL_RADIUS_TEXELS - 1.5 / factor);
          }
        }
      }
    }
  });

  it('mirrors its ceiling into the downsample stage', () => {
    const frag = read('./summation-downsample.frag.glsl');
    const m = frag.match(/const int STELLATA_MAX_DOWNSAMPLE = (\d+);/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(MAX_DOWNSAMPLE);
  });

  it('mirrors the kernel’s reach into the convolution chunk', () => {
    const chunk = read('./summation.glsl');
    const m = chunk.match(/const int STELLATA_SUMMATION_REACH = (\d+);/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(MAX_KERNEL_REACH_TEXELS);
  });
});

describe('the kernel weights', () => {
  it('fills a texel well inside the disc and empties one well outside', () => {
    expect(summationWeight(0, 0, 4)).toBe(1);
    expect(summationWeight(3, 0, 4)).toBe(1);
    expect(summationWeight(6, 0, 4)).toBe(0);
  });

  // A linear ramp across the boundary texel, which is what matches exact
  // circle-square overlap. Thresholding instead is 4x worse at the same tap
  // count (README.md § The kernel).
  it('ramps across the boundary texel rather than thresholding', () => {
    expect(summationWeight(4, 0, 4)).toBeCloseTo(0.5, 12);
    expect(summationWeight(4.25, 0, 4)).toBeCloseTo(0.25, 12);
  });

  // Every disc kernel of the same radius is the same operator whatever the
  // plate scale, so the mean of a UNIFORM field must be that field exactly.
  // This is not a tolerance: it is the identity the band's shipped display
  // table from Sol rests on (../../milkyway/calibration/README.md § The
  // gradient this produces), and it holds at every factor because
  // normalising by the summed weight is scale-free.
  it('returns a uniform field untouched at every reachable radius', () => {
    for (const fovDeg of [FOV_MIN_DEG, 20, 30, 50, 90, FOV_MAX_DEG]) {
      for (const viewport of [900, TALLEST_VIEWPORT_CSS_PX]) {
        for (const pixelRatio of [1, 1.5, MAX_PIXEL_RATIO]) {
          const radiusPx = bufferRadiusFor(fovDeg, viewport, pixelRatio);
          const texels = radiusPx / summationDownsample(radiusPx);
          expect(summationMean(() => 0.02, texels)).toBeCloseTo(0.02, 15);
        }
      }
    }
  });

  it('survives a radius under half a texel, where no offset is inside', () => {
    expect(summationMean((dx, dy) => (dx === 0 && dy === 0 ? 7 : 0), 0.01)).toBe(7);
  });

  // A linear operator on a linear field: the mean of a plane through the
  // fragment is the fragment's own value, because the disc is symmetric.
  // Any asymmetry in the weights — a truncated reach, an off-by-one offset —
  // shows up here as a shifted centre.
  it('is centred, so a linear ramp reads its own value', () => {
    for (const radius of [0.6, 1.95, 3, 4.4]) {
      expect(summationMean((dx) => 5 + 0.3 * dx, radius)).toBeCloseTo(5, 12);
      expect(summationMean((_dx, dy) => 5 - 0.7 * dy, radius)).toBeCloseTo(5, 12);
    }
  });
});

// The acceptance criterion the epic states as "the Galaxy viewed from 2 Mpc
// and a Local Group object of the same surface brightness at the same
// distance render at the same level". It is decided here rather than in
// either layer: both write the same gain off the same zero point into the
// same attachment, and the convolution is one operator over that attachment,
// so equal surface brightness IS equal level. The per-layer opt-out was the
// only thing that had ever broken it.
describe('one anchor for both volumetric emitters', () => {
  it('lands equal surface brightness on equal display luminance', () => {
    const level = (sb: number) =>
      surfaceBrightnessLuminance(BASE_EPOCH_EXPOSURE, sb, DEFAULT_SUMMATION_ARCSEC2);
    // Two patches of 22.0 mag/arcsec² — one Galactic, one extragalactic —
    // reach the same attachment-2 value, so the same mean and the same level.
    expect(summationMean(() => level(22), 3)).toBeCloseTo(level(22), 15);
    // And the anchor is the threshold itself: 22.0 is where an extended
    // source lands on L_THRESH (../emission/README.md § Extended sources).
    expect(level(22)).toBeCloseTo(0.02, 4);
  });

  it('holds that level at every FOV, which the pixel solid angle could not', () => {
    const summation = radiusFor(FOV_MAX_DEG);
    const zoomed = radiusFor(FOV_MIN_DEG);
    const level = (radiusPx: number) =>
      summationMean(
        () => surfaceBrightnessLuminance(BASE_EPOCH_EXPOSURE, 22, DEFAULT_SUMMATION_ARCSEC2),
        radiusPx / summationDownsample(radiusPx),
      );
    expect(level(summation)).toBeCloseTo(level(zoomed), 15);
    // What the same source would have done on the pixel solid angle: 5.4 mag
    // of drift across the same FOV range, which is the FOV-response split the
    // band and M31 used to show against each other.
    const perPixel = (fovDeg: number) =>
      surfaceBrightnessLuminance(BASE_EPOCH_EXPOSURE, 22, omegaPxFor(fovDeg, 900));
    expect(2.5 * Math.log10(perPixel(FOV_MAX_DEG) / perPixel(FOV_MIN_DEG)))
      .toBeCloseTo(5.40, 2);
  });
});

// The resolve is the only consumer, and the chunk it pastes has to be there.
describe('the resolve composites the convolution', () => {
  const resolveFrag = read('../tonemap.frag.glsl');

  it('adds the patch mean to attachment 0 before the operator', () => {
    expect(resolveFrag).toContain('#include <stellata_summation>');
    expect(resolveFrag).toMatch(/hdr\.rgb \+ stellataSummationMean\(/);
    expect(resolveFrag.indexOf('stellataSummationMean('))
      .toBeLessThan(resolveFrag.indexOf('stellataTonemap('));
  });

  // Pass-through parks the operator, not the convolution: the diffuse
  // emitters write no attachment 0 at all, so skipping the mean there would
  // drop the band and the Local Group out of the A/B entirely.
  it('keeps the diffuse light on the pass-through path', () => {
    const passThrough = resolveFrag.slice(resolveFrag.indexOf('uTonemapEnabled < 0.5'));
    expect(passThrough).toContain('outColor = vec4(linear, 1.0);');
  });

  // A diffuse emitter masks attachment 0 off, so its alpha is the clear's 0
  // while its rgb is the whole band. Handing that to a premultiplied canvas
  // is rgb > a — undefined by spec, black in practice, and the reason the
  // first cut of this pass rendered no band at all.
  it('owns the canvas alpha rather than carrying attachment 0’s', () => {
    expect(resolveFrag).not.toContain('hdr.a');
  });

  it('maps a display pixel onto the source with the factor’s own scale', () => {
    expect(resolveFrag).toContain('gl_FragCoord.xy * uSummationTexelScale');
  });
});

describe('the CPU mirror tracks the chunk', () => {
  const chunk = read('./summation.glsl');

  it('weights each tap the same way', () => {
    expect(chunk).toContain('clamp(radiusTexels + 0.5 - length(offset), 0.0, 1.0)');
  });

  it('normalises by the summed weight, not by the tap count', () => {
    expect(chunk).toContain('acc / weight');
    expect(chunk).not.toMatch(/acc \/ float\(/);
  });

  // Clamping to the edge rather than to zero. A fragment near the frame
  // border has a patch reaching sky the frame does not contain, and treating
  // that as black would ring the border — visible against the band.
  it('clamps taps into the live sub-rect', () => {
    expect(chunk).toContain('clamp(sourceTexel + offset, vec2(0.5), hi)');
    expect(chunk).toContain('vec2 hi = extent - 0.5;');
  });
});

describe('the patch radius against the design gate', () => {
  it('recovers the summation solid angle it was derived from', () => {
    const omegaPx = omegaPxFor(50, 900);
    const radiusPx = summationRadiusPx(DEFAULT_SUMMATION_ARCSEC2, omegaPx);
    const areaArcsec2 = Math.PI * (radiusPx * Math.sqrt(omegaPx)) ** 2;
    expect(areaArcsec2).toBeCloseTo(DEFAULT_SUMMATION_ARCSEC2, 6);
  });

  it('is the same angle in radians at any plate scale', () => {
    const angular = (fovDeg: number) =>
      radiusFor(fovDeg) * Math.sqrt(omegaPxFor(fovDeg, 900)) * ARCSEC_TO_RAD;
    expect(angular(FOV_MIN_DEG)).toBeCloseTo(angular(FOV_MAX_DEG), 12);
  });
});
