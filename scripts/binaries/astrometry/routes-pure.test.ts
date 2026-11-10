import { describe, expect, it } from 'vitest';

import { hip2AstrometryRow } from '../../catalog/sources/hip2-fixture';
import type { Hip2AstrometryRow } from '../../catalog/sources/hip2-source';
import { HIPPARCOS_EPOCH_JYEAR } from '../../../src/astro-core/astronomy-constants';
import { wdsPair } from '../../wds/wds-fixture';
import type { AthygRow } from '../load/athyg-pure';
import type { GaiaAstrometryRow } from '../load/gaia-pure';
import { gaiaAstrometryRow } from '../load/load-fixture';
import type { DecomposedPair, ResolvedComponent } from '../resolve/components-pure';
import { astrometryMap, athygAt, decomposed, indices, pairAt, resolved } from '../resolve/resolve-fixture';
import { nssRow } from '../orbits/nss-fixture';
import { minRhoPerSource, routeAstrometry, routePairs, type ComponentAstrometry, type MeasuredAstrometry } from './routes-pure';

const hip2Map = (rows: readonly (readonly [number, Partial<Hip2AstrometryRow>])[]): Map<number, Hip2AstrometryRow> =>
  new Map(rows.map(([hip, over]) => [hip, hip2AstrometryRow(over)]));

const nssFor = (...ids: string[]) => new Map(ids.map((id) => [id, nssRow({ sourceId: id, period: 100 })]));

const measured = (a: ComponentAstrometry): MeasuredAstrometry => {
  if (a.astrometryVia === 'unresolved') throw new Error('unresolved');
  return a;
};

describe('routeAstrometry', () => {
  it('leaves a component with no source and no HIP unresolved', () => {
    expect(routeAstrometry(resolved(), null, indices())).toEqual({ astrometryVia: 'unresolved' });
  });

  it('leaves a source the pull misses unresolved when no HIP reaches HIP2', () => {
    expect(routeAstrometry(resolved({ gaiaSourceId: '42' }), 1, indices()).astrometryVia).toBe('unresolved');
    expect(routeAstrometry(resolved({ hip: 99 }), null, indices()).astrometryVia).toBe('unresolved');
  });

  it('routes a Gaia-saturated primary with a HIP to HIP2, at J1991.25 (Sirius)', () => {
    const a = measured(routeAstrometry(
      resolved({ hip: 32349 }), null, indices({ hip2: hip2Map([[32349, { pmRaMasyr: -546, pmDeMasyr: -1223 }]]) }),
    ));
    expect(a.astrometryVia).toBe('hip2_long_baseline');
    expect(a.pmraMasyr).toBe(-546);
    expect(a.refEpoch).toBe(HIPPARCOS_EPOCH_JYEAR);
  });

  it('falls back to HIP2 when the source is outside the pull', () => {
    const a = routeAstrometry(resolved({ gaiaSourceId: '42', hip: 99 }), null, indices({ hip2: hip2Map([[99, {}]]) }));
    expect(a.astrometryVia).toBe('hip2_long_baseline');
  });

  it('routes a position-only Gaia row to HIP2 when HIP2 covers it (Castor AB)', () => {
    const a = measured(routeAstrometry(resolved({ gaiaSourceId: '1000', hip: 36850 }), null, indices({
      srcToAstrometry: astrometryMap([gaiaAstrometryRow({ sourceId: '1000', parallaxMas: null, parallaxErrorMas: null })]),
      hip2: hip2Map([[36850, { plxMas: 64.12 }]]),
    })));
    expect(a.astrometryVia).toBe('hip2_long_baseline');
    expect(a.parallaxMas).toBe(64.12);
  });

  it('keeps a position-only Gaia row as gaia_5p, parallax absent, when HIP2 misses', () => {
    const a = measured(routeAstrometry(resolved({ gaiaSourceId: '1000', hip: 99 }), null, indices({
      srcToAstrometry: astrometryMap([gaiaAstrometryRow({ sourceId: '1000', parallaxMas: null, parallaxErrorMas: null })]),
    })));
    expect(a.astrometryVia).toBe('gaia_5p');
    expect(a.parallaxMas).toBeNull();
  });

  it('defaults to gaia_5p, the row\'s own values at its own epoch', () => {
    const row = gaiaAstrometryRow({ sourceId: '42', raDeg: 12, pmraMasyr: 7 });
    const a = measured(routeAstrometry(resolved({ gaiaSourceId: '42' }), null, indices({ srcToAstrometry: astrometryMap([row]) })));
    expect(a).toMatchObject({ astrometryVia: 'gaia_5p', raDeg: 12, pmraMasyr: 7, refEpoch: 2016 });
  });

  it('tags an NSS source with an unreliable 5p fit gaia_nss_systemic, on either indicator', () => {
    const route = (over: Partial<GaiaAstrometryRow>): ComponentAstrometry => routeAstrometry(resolved({ gaiaSourceId: '7' }), null, indices({
      srcToAstrometry: astrometryMap([gaiaAstrometryRow({ sourceId: '7', ...over })]), srcToNss: nssFor('7'),
    }));
    expect(route({ ruwe: 2.5 }).astrometryVia).toBe('gaia_nss_systemic');
    expect(route({ ipdFracMultiPeak: 5 }).astrometryVia).toBe('gaia_nss_systemic');
    expect(route({}).astrometryVia).toBe('gaia_5p');
  });

  const pmCase = (rho: number, gaia: Partial<GaiaAstrometryRow>, hip2: Partial<Hip2AstrometryRow>, hipToGaia = true): ComponentAstrometry =>
    routeAstrometry(resolved({ gaiaSourceId: '1000' }), rho, indices({
      srcToAstrometry: astrometryMap([gaiaAstrometryRow({ sourceId: '1000', ...gaia })]),
      hipToGaia: new Map(hipToGaia ? [[999, '1000']] : []),
      hip2: hip2Map([[999, hip2]]),
    }));

  it('takes HIP2 for a close pair whose PMs disagree by more than 50 mas/yr on either axis', () => {
    const ra = measured(pmCase(3, { pmraMasyr: -462, pmdecMasyr: -914 }, { pmRaMasyr: -546, pmDeMasyr: -1223 }));
    expect(ra.astrometryVia).toBe('hip2_long_baseline');
    expect(ra.pmraMasyr).toBe(-546);
    expect(pmCase(2, { pmraMasyr: 10, pmdecMasyr: -100 }, { pmRaMasyr: 15, pmDeMasyr: -200 }).astrometryVia).toBe('hip2_long_baseline');
  });

  it('keeps Gaia for a wide pair, agreeing PMs, or a source no HIP reaches', () => {
    expect(pmCase(50, { pmraMasyr: 10, pmdecMasyr: 10 }, { pmRaMasyr: 100, pmDeMasyr: 100 }).astrometryVia).toBe('gaia_5p');
    expect(pmCase(1, { pmraMasyr: 10, pmdecMasyr: 10 }, { pmRaMasyr: 15, pmDeMasyr: 5 }).astrometryVia).toBe('gaia_5p');
    expect(pmCase(1, { pmraMasyr: 10, pmdecMasyr: 10 }, { pmRaMasyr: 200, pmDeMasyr: 200 }, false).astrometryVia).toBe('gaia_5p');
  });

  it('prefers NSS-systemic over HIP2 when both would fire', () => {
    const a = routeAstrometry(resolved({ gaiaSourceId: '1000' }), 1, indices({
      srcToAstrometry: astrometryMap([gaiaAstrometryRow({ sourceId: '1000', ruwe: 2, pmraMasyr: 10, pmdecMasyr: 10 })]),
      srcToNss: nssFor('1000'),
      hipToGaia: new Map([[999, '1000']]),
      hip2: hip2Map([[999, { pmRaMasyr: 200, pmDeMasyr: 200 }]]),
    }));
    expect(a.astrometryVia).toBe('gaia_nss_systemic');
  });
});

const ab = (components: string, rhoLast: number | null, primary: Partial<ResolvedComponent>, secondary: Partial<ResolvedComponent> = {}): DecomposedPair =>
  decomposed(wdsPair({ wdsId: 'X', discoverer: 'D', components, rhoLast, thetaLast: 0, precise: null }), {
    primary: { gaiaSourceId: null, resolveVia: 'unresolved', ...primary },
    secondary: { gaiaSourceId: null, resolveVia: 'unresolved', ...secondary },
  });

describe('minRhoPerSource', () => {
  it('takes the tightest ρ across the pair rows a source sits in', () => {
    expect(minRhoPerSource([ab('AB', 2, { gaiaSourceId: '42' }), ab('AC', 50, { gaiaSourceId: '42' })]).get('42')).toBe(2);
  });

  it('skips a pair with no ρ', () => {
    expect(minRhoPerSource([ab('AB', null, { gaiaSourceId: '7' })]).has('7')).toBe(false);
  });
});

describe('routePairs', () => {
  const astrometryOf = (r: ReturnType<typeof routePairs>): ComponentAstrometry[] =>
    r.pairs.flatMap((p) => [r.astrometry.get(p)!.primary, r.astrometry.get(p)!.secondary]);

  it('keys each side\'s route by its pair', () => {
    const r = routePairs([ab('AB', 10, { gaiaSourceId: '42' })], indices({ srcToAstrometry: astrometryMap([gaiaAstrometryRow({ sourceId: '42' })]) }), []);
    expect(astrometryOf(r).map((a) => a.astrometryVia)).toEqual(['gaia_5p', 'unresolved']);
  });

  it('routes every row of a source by its tightest ρ', () => {
    const idx = indices({
      srcToAstrometry: astrometryMap([gaiaAstrometryRow({ sourceId: '42', pmraMasyr: 10, pmdecMasyr: 10 })]),
      hipToGaia: new Map([[99, '42']]),
      hip2: hip2Map([[99, { pmRaMasyr: 200, pmDeMasyr: 10 }]]),
    });
    const r = routePairs([ab('AB', 2, { gaiaSourceId: '42' }), ab('AC', 50, { gaiaSourceId: '42' })], idx, []);
    expect(r.pairs.map((p) => r.astrometry.get(p)!.primary.astrometryVia)).toEqual(['hip2_long_baseline', 'hip2_long_baseline']);
  });
});

describe('routePairs — the AT-HYG position fallback', () => {
  const XI_UMA = { ra: 169.5454, dec: 31.5292 };
  const at = (ra: number, dec: number, over: Partial<AthygRow> = {}): AthygRow => athygAt({ ra, dec, ...over });
  const pairOf = (ra: number, dec: number, rhoLast: number | null, thetaLast: number | null, sides: { primary: Partial<ResolvedComponent>; secondary?: Partial<ResolvedComponent> }): DecomposedPair =>
    decomposed(pairAt({ wdsId: '11182+3132', components: 'AB', ra, dec, rhoLast, thetaLast }), {
      primary: { resolveVia: 'simbad_xid', ...sides.primary },
      secondary: { gaiaSourceId: null, resolveVia: 'unresolved', ...sides.secondary },
    });

  it('places both sides of a ξ UMa-shape pair Gaia and HIP2 both miss, parallax from the row\'s distance', () => {
    const row = at(XI_UMA.ra, XI_UMA.dec, { distPc: 10.4, pmRaMasyr: -425.24, pmDecMasyr: -581.01 });
    const p = pairOf(XI_UMA.ra, XI_UMA.dec, 2.6, 135, {
      primary: { gaiaSourceId: '756853643638639104', hip: 55203 },
      secondary: { gaiaSourceId: '756853643637996160', resolveVia: 'simbad_xid' },
    });
    const r = routePairs([p], indices({ athyg: [row] }), [row]);
    const a = r.astrometry.get(r.pairs[0])!;
    expect([a.primary.astrometryVia, a.secondary.astrometryVia]).toEqual(['athyg_position', 'athyg_position']);
    expect(measured(a.primary).parallaxMas).toBeCloseTo(1000 / 10.4, 9);
    expect(measured(a.primary).refEpoch).toBe(HIPPARCOS_EPOCH_JYEAR);
  });

  it('records the matched row on a component that had none, and only there', () => {
    const row = at(XI_UMA.ra, XI_UMA.dec, { distPc: 10.4 });
    const own = at(0, 0, { distPc: 3 });
    const p = pairOf(XI_UMA.ra, XI_UMA.dec, 2.6, 90, { primary: { gaiaSourceId: '1' }, secondary: { gaiaSourceId: '2', athygRow: own } });
    const r = routePairs([p], indices({ athyg: [row] }), [row]);
    expect(r.pairs[0].primary.athygRow).toBe(row);
    expect(r.pairs[0].secondary.athygRow).toBe(own);
  });

  it('runs only where the Gaia / HIP2 cascade left a component unresolved', () => {
    const row = at(100, 20, { gaia: '42', hip: 32349, distPc: 50 });
    const gaiaPair = pairOf(100, 20, 5, 0, { primary: { gaiaSourceId: '42' } });
    const hipPair = pairOf(100, 20, 10, 0, { primary: { gaiaSourceId: null, hip: 32349 } });
    const idx = indices({
      athyg: [row], srcToAstrometry: astrometryMap([gaiaAstrometryRow({ sourceId: '42' })]), hip2: hip2Map([[32349, {}]]),
    });
    const r = routePairs([gaiaPair, hipPair], idx, [row]);
    expect(r.pairs.map((p) => r.astrometry.get(p)!.primary.astrometryVia)).toEqual(['gaia_5p', 'hip2_long_baseline']);
  });

  it('leaves a component no AT-HYG row sits near, or no AT-HYG at all, unresolved', () => {
    const row = at(100, 20, { distPc: 5 });
    const p = pairOf(200, -40, 3, 0, { primary: { gaiaSourceId: '99' } });
    expect(routePairs([p], indices({ athyg: [row] }), [row]).astrometry.values().next().value!.primary.astrometryVia).toBe('unresolved');
    expect(routePairs([p], indices(), []).astrometry.values().next().value!.primary.astrometryVia).toBe('unresolved');
  });

  it('matches a high-PM GJ row on its stored J2000 coordinate (ξ UMa)', () => {
    const row = at(XI_UMA.ra, XI_UMA.dec, { distPc: 10.4, pmRaMasyr: -425.24, pmDecMasyr: -581.01 });
    const r = routePairs([pairOf(XI_UMA.ra, XI_UMA.dec, 2.6, 135, { primary: { gaiaSourceId: '1' } })], indices({ athyg: [row] }), [row]);
    expect(measured(r.astrometry.get(r.pairs[0])!.primary)).toMatchObject({ astrometryVia: 'athyg_position', raDeg: XI_UMA.ra, decDeg: XI_UMA.dec });
  });

  it('gives an unmeasured wide pair\'s secondary its primary\'s row, never a decoy where a ρ would land', () => {
    const rows = [at(100, 20, { distPc: 10 }), at(100, 20 + 999 / 3600, { distPc: 50 })];
    const p = pairOf(100, 20, null, null, { primary: { gaiaSourceId: '1' }, secondary: { gaiaSourceId: '2', resolveVia: 'simbad_xid' } });
    const a = routePairs([p], indices({ athyg: rows }), rows).astrometry.values().next().value!;
    expect(a.secondary.astrometryVia).toBe('athyg_position');
    expect(measured(a.secondary).parallaxMas).toBeCloseTo(100, 9);
  });

  it('leaves a row with no positive distance unresolved rather than invert zero', () => {
    const row = at(100, 20, { distPc: 0 });
    const r = routePairs([pairOf(100, 20, 3, 0, { primary: { gaiaSourceId: '99' } })], indices({ athyg: [row] }), [row]);
    expect(r.astrometry.get(r.pairs[0])!.primary.astrometryVia).toBe('unresolved');
  });

  it('refuses a row another letter of the system already binds by HIP', () => {
    const row = at(100, 20, { hip: 5, distPc: 10 });
    const owner = decomposed(pairAt({ wdsId: '11182+3132', components: 'CD', ra: 50, dec: 0, rhoLast: 30, thetaLast: 0 }), {
      primary: { gaiaSourceId: '9', resolveVia: 'simbad_xid', hip: 5 },
    });
    const r = routePairs([pairOf(100, 20, 3, 0, { primary: { gaiaSourceId: '99' } }), owner], indices({ athyg: [row] }), [row]);
    expect(r.siblingClaimed).toHaveLength(1);
    expect(r.astrometry.get(r.pairs[0])!.primary.astrometryVia).toBe('unresolved');
  });
});
