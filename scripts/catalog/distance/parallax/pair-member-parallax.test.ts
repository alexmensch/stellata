import { describe, it, expect } from 'vitest';

import {
  buildPairMemberParallaxIndex,
  lookupPairMemberParallax,
} from './pair-member-parallax';
import { PARALLAX_SN_FLOOR } from './parallax-cascade';
import { gaiaAstrometryRow } from '../astrometry-fixture';
import { multiplesRow } from '../../companions/multiples-fixture';
import type { GaiaAstrometryCatalogRow } from '../direction-cascade';

// σ Ori's real shape: the WDS root holds the blended Aa/Ab/A/B rows on one
// source that publishes no parallax, and HIP 26551 D on its own clean fit.
const ROOT = '05387-0236';
const BLEND_SOURCE = '3216486443742786048';
const SIBLING_SOURCE = '3216486478101982592';
const SIBLING_PLX = 2.4744;
const SIBLING_ERR = 0.0622;

const clean = (
  overrides: Partial<GaiaAstrometryCatalogRow> = {},
): GaiaAstrometryCatalogRow => gaiaAstrometryRow({
  parallaxMas: SIBLING_PLX, parallaxErrorMas: SIBLING_ERR,
  ruwe: 1.0689, ipdFracMultiPeak: 0, gMag: 6.5,
  ...overrides,
});

const sigmaOri = (gaia: Map<string, GaiaAstrometryCatalogRow>) =>
  buildPairMemberParallaxIndex([
    multiplesRow({
      systemId: `${ROOT}-Aa,Ab`, comp: 'Aa', hip: 26549,
      gaiaSourceId: BLEND_SOURCE, orbitRole: 'primary',
    }),
    multiplesRow({
      systemId: `${ROOT}-AB,D`, comp: 'AB', hip: 26549,
      gaiaSourceId: BLEND_SOURCE, orbitRole: 'primary',
    }),
    multiplesRow({
      systemId: `${ROOT}-AB,D`, comp: 'D', hip: 26551,
      gaiaSourceId: SIBLING_SOURCE, orbitRole: 'secondary',
    }),
  ], gaia);

describe('pair-member-parallax / the sibling a member borrows from', () => {
  it('lends the clean sibling fit to the member Gaia fitted no parallax for', () => {
    const index = sigmaOri(new Map([[SIBLING_SOURCE, clean()]]));
    expect(lookupPairMemberParallax(index, BLEND_SOURCE, 26549)).toEqual({
      sourceId: SIBLING_SOURCE, mas: SIBLING_PLX, errMas: SIBLING_ERR,
    });
    // 1000 / 2.4744 = 404.1 pc, against the 328.9 the S/N floor refused.
    expect(1000 / SIBLING_PLX).toBeCloseTo(404.14, 2);
  });

  it('reaches a member by its own HIP as well as its own source_id — the '
    + 'no-Gaia half of the cohort asks with the designation', () => {
    const index = sigmaOri(new Map([[SIBLING_SOURCE, clean()]]));
    expect(lookupPairMemberParallax(index, null, 26549)?.sourceId)
      .toBe(SIBLING_SOURCE);
  });

  it('never lends a record its own fit back, whichever key found the root', () => {
    const index = sigmaOri(new Map([[SIBLING_SOURCE, clean()]]));
    expect(lookupPairMemberParallax(index, SIBLING_SOURCE, 26551)).toBeNull();
  });

  it('offers nothing for a root no pair row names', () => {
    const index = sigmaOri(new Map([[SIBLING_SOURCE, clean()]]));
    expect(lookupPairMemberParallax(index, '1', 99999)).toBeNull();
  });
});

describe('pair-member-parallax / the coherence anchor gate', () => {
  const rejected: [string, Partial<GaiaAstrometryCatalogRow>][] = [
    ['a RUWE the fit does not stand behind', { ruwe: 1.5 }],
    ['a blended image (ipd_frac_multi_peak is a percent here)', { ipdFracMultiPeak: 37 }],
    ['a saturated source', { gMag: 2.5 }],
    ['a parallax the sign alone refuses', { parallaxMas: -0.3 }],
    ['a parallax indistinguishable from zero', { parallaxErrorMas: SIBLING_PLX * 2 }],
  ];
  for (const [label, overrides] of rejected) {
    it(`refuses to anchor a system on ${label}`, () => {
      const index = sigmaOri(new Map([[SIBLING_SOURCE, clean(overrides)]]));
      expect(lookupPairMemberParallax(index, BLEND_SOURCE, 26549)).toBeNull();
    });
  }

  it('admits a sibling exactly AT the floor, as the record\'s own parallax is', () => {
    const atFloor = clean({ parallaxErrorMas: SIBLING_PLX / PARALLAX_SN_FLOOR });
    expect(lookupPairMemberParallax(
      sigmaOri(new Map([[SIBLING_SOURCE, atFloor]])), BLEND_SOURCE, 26549,
    )).not.toBeNull();
  });
});

describe('pair-member-parallax / what the index admits', () => {
  it('takes the most precise sibling of several', () => {
    const noisy = '1000';
    const index = buildPairMemberParallaxIndex([
      multiplesRow({ systemId: `${ROOT}-AB`, comp: 'A', gaiaSourceId: BLEND_SOURCE, orbitRole: 'primary' }),
      multiplesRow({ systemId: `${ROOT}-AB`, comp: 'B', gaiaSourceId: noisy }),
      multiplesRow({ systemId: `${ROOT}-AC`, comp: 'C', gaiaSourceId: SIBLING_SOURCE }),
    ], new Map([
      [noisy, clean({ parallaxMas: 3.0, parallaxErrorMas: 0.9 })],
      [SIBLING_SOURCE, clean()],
    ]));
    expect(lookupPairMemberParallax(index, BLEND_SOURCE, null)?.sourceId)
      .toBe(SIBLING_SOURCE);
  });

  it('counts one blended source once however many component rows repeat it — '
    + 'Stage 2/3 bind it to every component of a sub-arcsec pair', () => {
    const index = sigmaOri(new Map([
      [BLEND_SOURCE, clean()], [SIBLING_SOURCE, clean()],
    ]));
    expect(index.entryCount).toBe(2);
  });

  it('ignores standalone rows, which are not sides of a physical pair', () => {
    const index = buildPairMemberParallaxIndex([
      multiplesRow({ systemId: `${ROOT}-AB`, comp: 'A', gaiaSourceId: BLEND_SOURCE, orbitRole: 'primary' }),
      multiplesRow({
        systemId: `${ROOT}-AB`, comp: 'Z', gaiaSourceId: SIBLING_SOURCE,
        orbitRole: 'standalone',
      }),
    ], new Map([[SIBLING_SOURCE, clean()]]));
    expect(index.entryCount).toBe(0);
    expect(lookupPairMemberParallax(index, BLEND_SOURCE, null)).toBeNull();
  });
});
