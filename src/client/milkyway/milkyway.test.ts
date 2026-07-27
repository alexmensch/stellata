import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GC_SIGHTLINE_COLUMN, GLOW_MAG_OFFSET, MilkyWay } from './milkyway';
import { makeHdrEmitterUniforms } from '../hdr/hdr-pipeline';
import {
  BASE_EPOCH_EXPOSURE,
  pixelSolidAngleArcsec2,
  surfaceBrightnessLuminance,
} from '../hdr/emission-pure';
import { angularToPx } from '../camera/controls/star-geometry';
import { srgbEncode, reinhardExtended, tonemapWhitePoint } from '../hdr/tonemap-pure';

function build() {
  const hdr = makeHdrEmitterUniforms();
  const uMaxAppMag = { value: 6.5 };
  const layer = new MilkyWay({ uMaxAppMag, hdr });
  const materials = layer.group.children.map(
    (m) => (m as THREE.Mesh).material as THREE.ShaderMaterial,
  );
  return { layer, hdr, uMaxAppMag, materials };
}

describe('MilkyWay uniform wiring', () => {
  it('binds the HDR seam by reference in both components', () => {
    const { hdr, materials } = build();
    expect(materials).toHaveLength(2);
    for (const key of [
      'uHdrTarget',
      'uWhitePoint',
      'uHighlightDesat',
      'uExposure',
      'uOmegaPxArcsec2',
    ] as const) {
      for (const mat of materials) expect(mat.uniforms[key]).toBe(hdr[key]);
    }
  });

  it('shares the star pipeline’s uMaxAppMag for the chart isobar', () => {
    const { uMaxAppMag, materials } = build();
    for (const mat of materials) expect(mat.uniforms.uMaxAppMag).toBe(uMaxAppMag);
  });

  // The layer emits physical luminance now; the per-layer squash and the
  // magnitude gate it needed are gone, not merely off the debug panel
  // (docs/science-hdr-pipeline.md § 9).
  it('carries neither the retired brightness scalar nor the gate input', () => {
    const { materials } = build();
    for (const mat of materials) {
      expect(mat.uniforms.uBrightnessScale).toBeUndefined();
      expect(mat.uniforms.uSizeSpan).toBeUndefined();
    }
  });

  it('exposes glowMagOffset as the only photometric knob left', () => {
    const { layer } = build();
    const v = layer.getValues();
    expect(v.glowMagOffset).toBe(GLOW_MAG_OFFSET);
    expect(v).not.toHaveProperty('brightness');
  });
});

describe('MilkyWay surface-brightness calibration', () => {
  it('anchors the GC sightline on the design gate’s band reference', () => {
    const surfaceBrightness = GLOW_MAG_OFFSET - 2.5 * Math.log10(GC_SIGHTLINE_COLUMN);
    expect(surfaceBrightness).toBeCloseTo(20.16, 2);
  });

  // Faint-but-present at strict physicality: the band sits well below a
  // threshold star's 0.15 of full scale and above the 8-bit floor the
  // resolve's dither breaks up. DR_MAG is the lever H7 tunes.
  it('renders the GC band in the visible toe at the base epoch', () => {
    const omega = pixelSolidAngleArcsec2(angularToPx(900, (50 * Math.PI) / 180));
    const y =
      GC_SIGHTLINE_COLUMN *
      surfaceBrightnessLuminance(BASE_EPOCH_EXPOSURE, GLOW_MAG_OFFSET, omega);
    const display = srgbEncode(reinhardExtended(y, tonemapWhitePoint()));
    expect(display).toBeGreaterThan(4 / 255);
    expect(display).toBeLessThan(srgbEncode(reinhardExtended(0.02, tonemapWhitePoint())));
  });

  it('dims the band quadratically with FOV — magnification costs surface brightness', () => {
    const wide = pixelSolidAngleArcsec2(angularToPx(900, (50 * Math.PI) / 180));
    const zoomed = pixelSolidAngleArcsec2(angularToPx(900, (5 * Math.PI) / 180));
    const ratio =
      surfaceBrightnessLuminance(BASE_EPOCH_EXPOSURE, GLOW_MAG_OFFSET, wide) /
      surfaceBrightnessLuminance(BASE_EPOCH_EXPOSURE, GLOW_MAG_OFFSET, zoomed);
    expect(ratio).toBeCloseTo(100, 6);
  });
});
