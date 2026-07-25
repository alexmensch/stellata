import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTER } from '../../filters/filter-state';
import {
  PERCEPTUAL_DISC_UNIFORM_KEYS,
  pickPerceptualDiscUniforms,
} from '../perceptual-disc-uniforms';
import { MIRROR_CAPACITY } from '../star-local-mirror';
import { buildStarSharedUniforms } from './star-shared-uniforms';

function build() {
  return buildStarSharedUniforms({
    pixelRatio: 2,
    fovYRad: 0.75,
    viewportW: 1600,
    viewportH: 900,
  });
}

describe('buildStarSharedUniforms', () => {
  it('seeds the renderer-derived slots from its options', () => {
    const u = build();
    expect(u.uPixelRatio.value).toBe(2);
    expect(u.uFovYRad.value).toBe(0.75);
    expect(u.uViewport.value.toArray()).toEqual([1600, 900]);
  });

  it('seeds the filter-driven slots from DEFAULT_FILTER', () => {
    const u = build();
    expect(u.uMaxAppMag.value).toBe(DEFAULT_FILTER.maxAppMag);
    expect(u.uSizeMin.value).toBe(DEFAULT_FILTER.sizeMin);
    expect(u.uSizeMax.value).toBe(DEFAULT_FILTER.sizeMax);
    expect(u.uSpectMask.value).toBe(DEFAULT_FILTER.spectMask);
  });

  it('sizes the local-member slot array to the mirror capacity, empty', () => {
    const u = build();
    expect(u.uLocalMemberIdx.value).toHaveLength(MIRROR_CAPACITY);
    expect(u.uLocalMemberIdx.value.every((v) => v === -1)).toBe(true);
  });

  it('hands the planet pipeline the same value-object identities', () => {
    const u = build();
    const picked = pickPerceptualDiscUniforms(u);
    for (const key of PERCEPTUAL_DISC_UNIFORM_KEYS) {
      expect(picked[key]).toBe(u[key]);
    }
  });

  it('returns a fresh map per call — two pipelines never share slots', () => {
    expect(build().uCameraPos).not.toBe(build().uCameraPos);
  });
});
