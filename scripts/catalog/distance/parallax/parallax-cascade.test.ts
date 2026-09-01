import { describe, it, expect } from 'vitest';

import {
  resolveParallax,
  DIST_VIA_VALUES,
  DIST_VIA_COUNT_KEY,
  PARALLAX_SN_FLOOR,
  PARALLAX_LOW_PRECISION_SN,
  type ParallaxSources,
} from './parallax-cascade';
import { gaiaAstrometryRow } from '../astrometry-fixture';
import type { CitedParallax } from '../../cited-parallax';
import type { SiblingParallax } from './pair-member-parallax';
import type { GlieseRow } from '../../gliese-parse';

const GAIA_DR2 = '2018yCat.1345....0G';
const GAIA_DR2_PAPER = '2018A&A...616A...1G';
const VAN_LEEUWEN = '2007A&A...474..653V';
const LITERATURE = '2014ApJ...784..156D';

const NONE: ParallaxSources = {
  gaia: null, hip2: null, cns5: null, gliese: null, simbad: null, pairMember: null,
};

const hip2 = (plxMas: number, plxErrorMas: number | null) => ({
  raDeg: 0, decDeg: 0, plxMas, plxErrorMas, pmRaMasyr: null, pmDeMasyr: null,
});
const gliese = (plxMas: number | null): GlieseRow => ({
  name: 'Gl 423', comp: 'A', vMag: null, bMinusV: null, spectral: null,
  plxMas, plxErrMas: 1.0,
});
// One builder for both bibcoded tiers — CNS5 and SIMBAD carry the same
// CitedParallax. CNS5 publishes no error, which is what `errMas` null states.
const sibling = (mas: number): SiblingParallax => ({
  sourceId: '3216486478101982592', mas, errMas: 0.0622,
});
const cited = (
  mas: number, bibcode: string, errMas: number | null = 0.1,
): CitedParallax => ({ mas, errMas, bibcode });
const simbad = (mas: number, bibcode: string): CitedParallax => cited(mas, bibcode);

describe('parallax-cascade / tier order', () => {
  it('takes the record\'s own Gaia 5p parallax ahead of every other tier', () => {
    const res = resolveParallax({
      ...NONE,
      gaia: gaiaAstrometryRow({ parallaxMas: 40, parallaxErrorMas: 0.1 }),
      hip2: hip2(10, 0.1),
      cns5: cited(20, LITERATURE, null),
      gliese: gliese(30),
      simbad: simbad(50, LITERATURE),
    }, false, false);
    expect(res.via).toBe('gaia_dr3_inversion');
    expect(res.plxMas).toBe(40);
  });

  it('mirrors the direction cascade: HIP2 only where Gaia states no parallax, '
    + 'never over a converged fit', () => {
    const twoP = gaiaAstrometryRow({ parallaxMas: null, parallaxErrorMas: null });
    expect(resolveParallax({ ...NONE, gaia: twoP, hip2: hip2(10, 0.5) }, true, false).via)
      .toBe('hip2_parallax');
  });

  it('falls Gaia → HIP2 → CNS5 → Gliese → SIMBAD in order', () => {
    const order: Array<[Partial<ParallaxSources>, string]> = [
      [{ hip2: hip2(10, 0.5) }, 'hip2_parallax'],
      [{ cns5: cited(20, LITERATURE, null) }, 'cns5_plx'],
      [{ gliese: gliese(30) }, 'gliese_plx'],
      [{ simbad: simbad(50, LITERATURE) }, 'simbad_plx'],
      [{ pairMember: sibling(2.47) }, 'pair_member_parallax'],
    ];
    for (const [src, via] of order) {
      expect(resolveParallax({ ...NONE, ...src }, false, false).via).toBe(via);
    }
  });

  it('routes Sol to the curated tier — no identifier reaches it and its '
    + 'distance is zero rather than a parallax', () => {
    const res = resolveParallax(NONE, false, true);
    expect(res.via).toBe('curated');
    expect(res.plxMas).toBeNull();
  });

  it('ignores a non-positive parallax rather than inverting it', () => {
    expect(resolveParallax({ ...NONE, hip2: hip2(-1.2, 0.5) }, false, false).via).toBe('none');
    expect(resolveParallax({ ...NONE, hip2: hip2(0, 0.5) }, false, false).via).toBe('none');
  });
});

describe('parallax-cascade / the precision floor', () => {
  it('refuses a parallax indistinguishable from zero — its inverse is '
    + 'unbounded, not merely imprecise', () => {
    // HIP 77442: 0.04 ± 0.36 mas, S/N 0.11. Inverted it reads 25,000 pc for a
    // V 5.89 naked-eye star, which is the catastrophe the floor exists for.
    const res = resolveParallax({ ...NONE, hip2: hip2(0.04, 0.36) }, false, false);
    expect(res.via).toBe('none');
    expect(res.refused).toBe(true);
  });

  it('admits a parallax fractionally above the floor — HIP 37 at S/N 1.03 '
    + 'ships flagged rather than dropping, and the boundary is exclusive', () => {
    const res = resolveParallax({ ...NONE, hip2: hip2(2.62, 2.55) }, false, false);
    expect(res.via).toBe('hip2_parallax');
    expect(res.lowPrecision).toBe(true);
  });

  it('admits a parallax above the floor but below the 20% bound, and flags it', () => {
    const res = resolveParallax({ ...NONE, hip2: hip2(10, 4) }, false, false);
    expect(res.via).toBe('hip2_parallax');
    expect(res.lowPrecision).toBe(true);
  });

  it('does not flag a parallax at or above the 20% bound', () => {
    expect(resolveParallax({ ...NONE, hip2: hip2(10, 2) }, false, false).lowPrecision)
      .toBe(false);
  });

  it('admits a parallax whose error is unpublished — an absent error bar is '
    + 'not evidence the value is bad', () => {
    const res = resolveParallax({ ...NONE, hip2: hip2(10, null) }, false, false);
    expect(res.via).toBe('hip2_parallax');
    expect(res.lowPrecision).toBe(false);
  });

  it('the floor sits below the low-precision bound, so the flagged band is '
    + 'non-empty by construction', () => {
    expect(PARALLAX_SN_FLOOR).toBeLessThan(PARALLAX_LOW_PRECISION_SN);
    expect(PARALLAX_SN_FLOOR).toBe(1.0);
    expect(PARALLAX_LOW_PRECISION_SN).toBe(5.0);
  });
});

describe('parallax-cascade / the Gaia-bibcode skip rule', () => {
  it('refuses a CNS5 or SIMBAD parallax citing a Gaia release on a 2p row', () => {
    const twoP = gaiaAstrometryRow({ parallaxMas: null, parallaxErrorMas: null });
    const res = resolveParallax({
      ...NONE,
      gaia: twoP,
      cns5: cited(114.49, GAIA_DR2, null),
      simbad: simbad(114.5, GAIA_DR2),
    }, true, false);
    expect(res.via).toBe('none');
    expect(res.refused).toBe(true);
  });

  it('catches the release paper as well as the VizieR table — CNS5 cites one '
    + 'form and SIMBAD the other', () => {
    const res = resolveParallax({
      ...NONE,
      cns5: cited(114.49, GAIA_DR2_PAPER, null),
    }, true, false);
    expect(res.via).toBe('none');
  });

  it('keeps a Gaia citation where no Gaia solution stands behind the row — '
    + 'the rule gates on the 2p fit, not on the tier', () => {
    const res = resolveParallax({
      ...NONE,
      cns5: cited(114.49, GAIA_DR2, null),
    }, false, false);
    expect(res.via).toBe('cns5_plx');
  });

  it('falls THROUGH a refused tier to Gliese, which no Gaia release stands '
    + 'behind — this is what keeps 44 Boötis', () => {
    const res = resolveParallax({
      ...NONE,
      gaia: gaiaAstrometryRow({ parallaxMas: null, parallaxErrorMas: null }),
      cns5: cited(114.49, GAIA_DR2, null),
      gliese: gliese(115.0),
    }, true, false);
    expect(res.via).toBe('gliese_plx');
    expect(res.plxMas).toBe(115.0);
  });

  it('does not refuse a DR1/TGAS citation — a joint Gaia+Tycho solution is a '
    + 'different measurement, not the same fit returning', () => {
    const res = resolveParallax({
      ...NONE,
      simbad: simbad(7.2, '2016A&A...595A...2G'),
    }, true, false);
    expect(res.via).toBe('simbad_plx');
  });
});

describe('parallax-cascade / the van Leeuwen laundering rule', () => {
  it('refuses a SIMBAD parallax citing van Leeuwen once the floor has already '
    + 'refused that same HIP2 value', () => {
    const res = resolveParallax({
      ...NONE,
      hip2: hip2(0.04, 0.36),
      simbad: simbad(0.04, VAN_LEEUWEN),
    }, false, false);
    expect(res.via).toBe('none');
    expect(res.refused).toBe(true);
  });

  it('keeps a van Leeuwen citation where the floor never fired — the rule is '
    + 'about re-serving a refusal, not about the publication', () => {
    const res = resolveParallax({ ...NONE, simbad: simbad(7.61, VAN_LEEUWEN) }, false, false);
    expect(res.via).toBe('simbad_plx');
  });

  it('still admits an INDEPENDENT SIMBAD value after the floor refuses HIP2', () => {
    const res = resolveParallax({
      ...NONE,
      hip2: hip2(0.04, 0.36),
      simbad: simbad(24.7, LITERATURE),
    }, false, false);
    expect(res.via).toBe('simbad_plx');
    expect(res.plxMas).toBe(24.7);
  });
});

describe('parallax-cascade / the bound-sibling tier', () => {
  it('places a record no owned tier reached on its sibling\'s clean fit — this '
    + 'is what keeps sigma Orionis', () => {
    const res = resolveParallax(
      { ...NONE, gaia: gaiaAstrometryRow({ parallaxMas: null }), pairMember: sibling(2.4744) },
      true, false,
    );
    expect(res.via).toBe('pair_member_parallax');
    expect(1000 / (res.plxMas as number)).toBeCloseTo(404.14, 2);
    expect(res.refused).toBe(false);
  });

  it('lends a neighbour\'s measurement only after every tier stating the '
    + 'record\'s OWN has been asked', () => {
    const res = resolveParallax(
      { ...NONE, simbad: simbad(50, LITERATURE), pairMember: sibling(2.47) },
      false, false,
    );
    expect(res.via).toBe('simbad_plx');
  });

  it('rescues a row a skip rule refused, and stops calling it refused', () => {
    const res = resolveParallax({
      ...NONE,
      gaia: gaiaAstrometryRow({ parallaxMas: null }),
      simbad: simbad(3.04, GAIA_DR2),
      pairMember: sibling(2.4744),
    }, true, false);
    expect(res.via).toBe('pair_member_parallax');
    expect(res.refused).toBe(false);
  });
});

describe('parallax-cascade / the residual', () => {
  it('separates a row nothing measured from one whose value was refused', () => {
    expect(resolveParallax(NONE, false, false)).toMatchObject({
      via: 'none', refused: false,
    });
    expect(resolveParallax({ ...NONE, hip2: hip2(1, 5) }, false, false)).toMatchObject({
      via: 'none', refused: true,
    });
  });

  it('never returns an override layer — those replace a resolved distance and '
    + 'are not parallax tiers', () => {
    const vias = new Set(DIST_VIA_VALUES);
    expect(vias.has('bailer_jones')).toBe(true);
    expect(vias.has('lmc_kinematic')).toBe(true);
    for (const src of [NONE, { ...NONE, hip2: hip2(10, 0.1) }]) {
      const via = resolveParallax(src, false, false).via;
      expect(via).not.toBe('bailer_jones');
      expect(via).not.toBe('lmc_kinematic');
    }
  });

  it('every tier reports into a distinct build-count field', () => {
    const keys = DIST_VIA_VALUES.map((v) => DIST_VIA_COUNT_KEY[v]);
    expect(new Set(keys).size).toBe(DIST_VIA_VALUES.length);
  });
});
