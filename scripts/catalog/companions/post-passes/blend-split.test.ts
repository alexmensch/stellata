import { describe, expect, it } from 'vitest';
import { SPECTRAL_UNKNOWN } from '../../../../src/catalog-format/spectral/spectral-classify';
import { makeStar } from '../../parse/star-fixture';
import { splitBlends } from './blend-split';

describe('splitBlends', () => {
  it('dims each record of a shared source by 2.5·log10(N), and leaves a lone record alone', () => {
    const pair = [makeStar({ absmag: 8 }), makeStar({ absmag: 8 })].map((star) => ({ star, spectral: SPECTRAL_UNKNOWN }));
    const lone = { star: makeStar({ absmag: 6 }), spectral: SPECTRAL_UNKNOWN };
    const splits = splitBlends([pair, [lone]]);
    expect(splits.map((s) => s.n)).toEqual([2, 2]);
    expect(pair[0].star.absmag).toBeCloseTo(8 + 2.5 * Math.log10(2), 12);
    expect(pair[1].star.physicalRadius).toBe(splits[1].radius.rSun);
    expect(lone.star.absmag).toBe(6);
  });
});
