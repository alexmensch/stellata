import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  RESOLVED_HOLE_BANDS,
  RESOLVED_HOLE_SHELLS,
  resolvedHoleIndex,
  unresolvedHoleTexels,
} from './resolved-fraction-pure';
import { RESOLVED_HOLE_VALUES } from './resolved-hole-table';
import { makeResolvedHoleTexture, writeResolvedHoleTexture } from './resolved-hole-texture';

const texelAt = (tex: THREE.DataTexture, i: number) =>
  THREE.DataUtils.fromHalfFloat((tex.image.data as Uint16Array)[i]);

describe('the resolution-hole texture', () => {
  // README.md § The table is a texture, not a uniform array — every one
  // of these is load-bearing.
  it('is a 32x8 half-float red texture, linear and clamped', () => {
    const tex = makeResolvedHoleTexture();
    expect(tex.image.width).toBe(RESOLVED_HOLE_SHELLS);
    expect(tex.image.height).toBe(RESOLVED_HOLE_BANDS);
    expect(tex.format).toBe(THREE.RedFormat);
    expect(tex.type).toBe(THREE.HalfFloatType);
    expect(tex.minFilter).toBe(THREE.LinearFilter);
    expect(tex.magFilter).toBe(THREE.LinearFilter);
    expect(tex.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(tex.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(tex.flipY).toBe(false);
    expect(tex.generateMipmaps).toBe(false);
  });

  // Row-major with one row per |sin b| band and flipY off, which is what
  // makes `resolvedHoleIndex` the texel index too. A transpose here
  // renders a plausible wrong sky.
  it('lays the table out band per row, shell per column', () => {
    const tex = makeResolvedHoleTexture();
    writeResolvedHoleTexture(tex);
    const expected = unresolvedHoleTexels();
    for (const [shell, band] of [[0, 0], [17, 0], [6, 5], [31, 7]]) {
      const i = resolvedHoleIndex(shell, band);
      expect(texelAt(tex, i)).toBeCloseTo(expected[i], 3);
    }
  });

  // `version` is what a re-upload is keyed on, so a write that did not
  // bump it would leave the GPU on the previous slider position — and
  // nothing else in the frame touches this texture.
  it('writes in place and re-uploads only on a write', () => {
    const tex = makeResolvedHoleTexture();
    expect(texelAt(tex, resolvedHoleIndex(18, 0))).toBe(0);
    const data = tex.image.data;
    const version = tex.version;

    writeResolvedHoleTexture(tex);
    expect(tex.image.data).toBe(data);
    expect(tex.version).toBe(version + 1);

    writeResolvedHoleTexture(tex, 0);
    expect(tex.version).toBe(version + 2);
    // Hole off: the band owes the whole of the model's light again.
    for (let i = 0; i < RESOLVED_HOLE_VALUES.length; i++) expect(texelAt(tex, i)).toBe(1);
  });
});
