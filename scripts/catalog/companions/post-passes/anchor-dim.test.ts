import { describe, expect, it } from 'vitest';
import { SPECTRAL_UNKNOWN } from '../../../../src/catalog-format/spectral/spectral-classify';
import { makeStar } from '../../parse/star-fixture';
import type { Star } from '../../parse/stars-parse';
import { componentDepth, dimAnchors, GAIA_BLEND_MAX_SEP_ARCSEC, type AnchorDimCandidate } from './anchor-dim';

const BLEND_MAG = 5 - 2.5 * Math.log10(1 + Math.pow(10, -0.4));

function candidate(member: Star, overrides: Partial<AnchorDimCandidate> = {}): AnchorDimCandidate {
  return {
    anchorIdx: 0, member, memberSpectral: SPECTRAL_UNKNOWN, source: 'own', dmag: 1, structural: false,
    memberWdsMag: 6, anchorWdsMag: 5, anchorDepth: 1, sepArcsec: GAIA_BLEND_MAX_SEP_ARCSEC / 2, av: 0, ...overrides,
  };
}

describe('componentDepth', () => {
  it('counts designators, and ranks a compound below any single letter', () => {
    expect(['A', 'Aa', 'Aa1', 'AB', 'Aab'].map(componentDepth)).toEqual([1, 2, 3, 0, 0]);
  });
});

describe('dimAnchors', () => {
  it('judges every candidate once, and subtracts the member the fit puts inside a Gaia anchor\'s blend', () => {
    const anchor = makeStar({ x: 10, absmag: BLEND_MAG, vVia: 'gaia_riello', originKey: 'spine:anchor' });
    const inside = makeStar({ x: 10, absmag: 6, originKey: 'spine:inside' });
    const resolved = makeStar({ x: 10, absmag: 9, gaiaSourceId: '42' });
    const wide = makeStar({ x: 10, absmag: 9 });
    const cands = [candidate(inside), candidate(resolved), candidate(wide, { sepArcsec: 5 })];
    const stars = [anchor];
    const { verdicts, dims } = dimAnchors(cands, (i) => stars[i]);
    expect(verdicts.map((v) => [v.cand.member, v.verdict])).toEqual([
      [resolved, 'gaia-resolved'], [wide, 'beyond-separation'], [inside, 'subtracted'],
    ]);
    expect(dims.map((d) => d.members)).toEqual([['spine:inside']]);
    expect(anchor.absmag).toBeCloseTo(5, 10);
    expect(anchor.physicalRadius).toBe(dims[0].anchorRadius.rSun);
  });

  it('leaves the anchor alone when "anchor alone" already fits', () => {
    const anchor = makeStar({ x: 10, absmag: 5, vVia: 'gaia_riello' });
    const faint = makeStar({ x: 10, absmag: 15 });
    const { verdicts, dims } = dimAnchors([candidate(faint, { memberWdsMag: 15 })], () => anchor);
    expect(verdicts.map((v) => v.verdict)).toEqual(['outside']);
    expect(dims).toEqual([]);
    expect(anchor.absmag).toBe(5);
  });
});
