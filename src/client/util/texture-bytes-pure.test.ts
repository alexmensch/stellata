import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MIP_CHAIN_FACTOR, mipmapFactor, texelBytes } from './texture-bytes-pure';

describe('texture-bytes / texelBytes', () => {
  it('sizes the HDR attachment formats', () => {
    // The three colour attachments the frame binds: RGBA16F, RG16F, and
    // the second RGBA16F. Getting these wrong misprices the single
    // largest viewport-scaled allocation in the app.
    expect(texelBytes(THREE.RGBAFormat, THREE.HalfFloatType)).toBe(8);
    expect(texelBytes(THREE.RGFormat, THREE.HalfFloatType)).toBe(4);
    expect(texelBytes(THREE.RedFormat, THREE.FloatType)).toBe(4);
    expect(texelBytes(THREE.RGBAFormat, THREE.UnsignedByteType)).toBe(4);
  });

  it('sizes the formats the planet layer narrows its maps to', () => {
    // The VRAM budget is charged from these, so a map that narrows
    // without a row here would be over-charged and evict maps that fit.
    expect(texelBytes(THREE.RedFormat, THREE.UnsignedByteType)).toBe(1);
    expect(texelBytes(THREE.RGFormat, THREE.UnsignedByteType)).toBe(2);
  });

  it('reads a packed type as a whole-texel size, not per channel', () => {
    // Depth24+stencil8 is 4 bytes for the texel, not 4 per channel.
    expect(texelBytes(THREE.DepthStencilFormat, THREE.UnsignedInt248Type)).toBe(4);
  });

  it('returns null for a compressed format rather than guessing', () => {
    expect(texelBytes(THREE.RGB_S3TC_DXT1_Format, THREE.UnsignedByteType)).toBeNull();
  });
});

describe('texture-bytes / mipmapFactor', () => {
  function texture(generateMipmaps: boolean, minFilter: THREE.MinificationTextureFilter) {
    const t = new THREE.Texture();
    t.generateMipmaps = generateMipmaps;
    t.minFilter = minFilter;
    return t;
  }

  it('charges the chain only when the filter samples it', () => {
    expect(mipmapFactor(texture(true, THREE.LinearMipmapLinearFilter)))
      .toBeCloseTo(MIP_CHAIN_FACTOR, 12);
  });

  it('charges nothing when generateMipmaps is on but the filter is not a mipmap filter', () => {
    // three's default generateMipmaps is true, so keying on it alone
    // would inflate every NearestFilter data texture in the app by a third.
    expect(mipmapFactor(texture(true, THREE.LinearFilter))).toBe(1);
    expect(mipmapFactor(texture(true, THREE.NearestFilter))).toBe(1);
  });

  it('charges nothing when mipmaps are off', () => {
    expect(mipmapFactor(texture(false, THREE.LinearMipmapLinearFilter))).toBe(1);
  });
});
