import { describe, it, expect } from 'vitest';

import {
  buildPairMemberParallaxIndex,
  lookupPairMemberParallax,
  pairMemberSourceIds,
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

  // The tier's reach is stated as a partition, so every refusal path lands in
  // exactly one bucket and the four sum with `entryCount` to the dedup's input
  // — two sources here, the blend and the sibling. A path summing nowhere
  // would leave the README's table quietly short. The kept row is in the table
  // because `entryCount` is the fifth term, not a spectator to the other four.
  const attributed: [string, Partial<GaiaAstrometryCatalogRow> | null, number, {
    noAstrometryRow: number; noParallax: number;
    notAnchorGrade: number; belowSnFloor: number;
  }][] = [
    ['a clean sibling', {}, 1,
      { noAstrometryRow: 0, noParallax: 1, notAnchorGrade: 0, belowSnFloor: 0 }],
    ['a RUWE the fit does not stand behind', { ruwe: 1.5 }, 0,
      { noAstrometryRow: 0, noParallax: 1, notAnchorGrade: 1, belowSnFloor: 0 }],
    ['a parallax Gaia never published', { parallaxMas: null }, 0,
      { noAstrometryRow: 0, noParallax: 2, notAnchorGrade: 0, belowSnFloor: 0 }],
    // The anchor gate weighs the fit, not the S/N, so a parallax
    // indistinguishable from zero clears it and the floor is what refuses.
    ['a parallax indistinguishable from zero', { parallaxErrorMas: SIBLING_PLX * 2 }, 0,
      { noAstrometryRow: 0, noParallax: 1, notAnchorGrade: 0, belowSnFloor: 1 }],
    // The one refusal a re-pull can fix, which is why the build pins it at 0.
    ['no astrometry row at all', null, 0,
      { noAstrometryRow: 2, noParallax: 0, notAnchorGrade: 0, belowSnFloor: 0 }],
  ];
  for (const [label, overrides, kept, expected] of attributed) {
    it(`attributes ${label} to one bucket, and the five still partition`, () => {
      // σ Ori's blend publishes no parallax of its own, so wherever the pull
      // holds a row for it at all it lands in `noParallax`.
      const gaia = overrides === null ? new Map<string, GaiaAstrometryCatalogRow>()
        : new Map([
          [BLEND_SOURCE, clean({ parallaxMas: null })],
          [SIBLING_SOURCE, clean(overrides)],
        ]);
      const { refused, entryCount } = sigmaOri(gaia);
      expect(entryCount).toBe(kept);
      expect(refused).toEqual(expected);
      const total = Object.values(refused).reduce((a, b) => a + b, 0);
      expect(total + entryCount).toBe(2);
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

describe('pair-member-parallax / the astrometry request contribution', () => {
  const rows = [
    multiplesRow({ systemId: `${ROOT}-AB`, comp: 'A', gaiaSourceId: BLEND_SOURCE, orbitRole: 'primary' }),
    multiplesRow({ systemId: `${ROOT}-AB`, comp: 'B', gaiaSourceId: BLEND_SOURCE }),
    multiplesRow({ systemId: `${ROOT}-AB,D`, comp: 'D', gaiaSourceId: SIBLING_SOURCE }),
    multiplesRow({ systemId: `${ROOT}-_Z`, comp: 'Z', gaiaSourceId: '999', orbitRole: 'standalone' }),
    multiplesRow({ systemId: `${ROOT}-AE`, comp: 'E', gaiaSourceId: null }),
  ];

  it('names every kept-physical pair member the tier could read, once', () => {
    expect([...pairMemberSourceIds(rows)].sort())
      .toEqual([BLEND_SOURCE, SIBLING_SOURCE].sort());
  });

  it('leaves standalone rows out, matching what the index will read', () => {
    expect(pairMemberSourceIds(rows).has('999')).toBe(false);
  });

  it('asks for a source whether or not the table already answers — the request '
    + 'cannot be keyed on which rows park, since that is the build it feeds', () => {
    // No astrometry at all: the request still has to name these sources, or
    // the pull can never turn them into candidates.
    const index = buildPairMemberParallaxIndex(rows, new Map());
    expect(index.entryCount).toBe(0);
    expect(pairMemberSourceIds(rows).size).toBe(2);
  });
});
