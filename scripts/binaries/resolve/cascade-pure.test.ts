import { describe, expect, it } from 'vitest';

import { componentKey, pairRowKey } from '../component-tokens-pure';
import { athygRow, orb6Entry, wdsPair } from '../load/load-fixture';
import type { Orb6Entry, WdsPair } from '../load/wds-pure';
import {
  buildSystemLetterPositions, groupOrb6ByPair, resolveComponent, resolveViaCcdm, resolveViaPosition, resolveViaSimbad,
} from './cascade-pure';
import { athygAt, indices, pairAt, resolved, xid } from './resolve-fixture';

const orb6 = (wdsId: string, components: string, hip: number | null): Orb6Entry =>
  orb6Entry({ wdsId, components, hip, grade: 5 });

describe('resolveComponent', () => {
  const resolveA = (pair: WdsPair, entries: Orb6Entry[], idx: ReturnType<typeof indices>, isPrimary = true, comp = 'A') =>
    resolveComponent(pair, comp, isPrimary, entries, idx);

  it('binds the primary through ORB6\'s HIP and the Gaia cross-walk', () => {
    const pair = wdsPair({ wdsId: '06451-1643', components: 'AB' });
    const r = resolveA(pair, [orb6('06451-1643', 'AB', 32349)], indices({ hipToGaia: new Map([[32349, '2947050466531873024']]) }));
    expect(r.resolveVia).toBe('orb6_hip');
    expect(r.gaiaSourceId).toBe('2947050466531873024');
  });

  it('never fires orb6_hip for a secondary', () => {
    const pair = wdsPair({ components: 'AB' });
    const r = resolveA(pair, [orb6(pair.wdsId, 'AB', 100)], indices({ hipToGaia: new Map([[100, '999']]) }), false, 'B');
    expect(r.resolveVia).toBe('unresolved');
    expect(r.gaiaSourceId).toBeNull();
  });

  it('falls to AT-HYG\'s native gaia when the cross-walk misses the ORB6 HIP', () => {
    const pair = wdsPair({ components: 'AB' });
    const idx = indices({ athyg: [athygRow({ hip: 42, gaia: '12345', raDeg: 100, decDeg: 0 })] });
    const r = resolveA(pair, [orb6(pair.wdsId, 'AB', 42)], idx);
    expect(r.resolveVia).toBe('athyg_gaia_native');
    expect(r.gaiaSourceId).toBe('12345');
  });

  it('is unresolved with no HIP signal', () => {
    const r = resolveA(wdsPair({ components: 'AB' }), [], indices({ hipToGaia: new Map([[1, '1']]) }));
    expect(r.resolveVia).toBe('unresolved');
    expect(r.gaiaSourceId).toBeNull();
  });

  it('drops an ORB6 HIP whose position is far off the pair coord, HIP and all (ε Equ)', () => {
    const pair = wdsPair({ wdsId: '20591+0418', components: 'Aa,Ab', precise: { raDeg: 315.0, decDeg: 4.3 } });
    const idx = indices({
      hipToGaia: new Map([[103579, '2018523585846555648']]),
      athyg: [athygRow({ hip: 103579, gaia: '2018523585846555648', raDeg: 315.4, decDeg: 44.1 })],
    });
    const r = resolveA(pair, [orb6(pair.wdsId, 'Aa,Ab', 103579)], idx, true, 'Aa');
    expect(r.resolveVia).toBe('unresolved');
    expect(r.gaiaSourceId).toBeNull();
    expect(r.hip).toBeNull();
  });

  const sirius = indices({
    hipToGaia: new Map([[32349, '2947050466531873024']]),
    athyg: [athygRow({ hip: 32349, gaia: '2947050466531873024', raDeg: 101.3, decDeg: -16.7 })],
  });

  it('trusts an ORB6 HIP sitting on the pair coord', () => {
    const pair = wdsPair({ wdsId: '06451-1643', components: 'AB', precise: { raDeg: 101.3, decDeg: -16.7 } });
    const r = resolveA(pair, [orb6(pair.wdsId, 'AB', 32349)], sirius);
    expect(r.resolveVia).toBe('orb6_hip');
    expect(r.gaiaSourceId).toBe('2947050466531873024');
  });

  it('trusts an ORB6 HIP when the pair has no precise coord', () => {
    const pair = wdsPair({ wdsId: '06451-1643', components: 'AB', precise: null });
    expect(resolveA(pair, [orb6(pair.wdsId, 'AB', 32349)], sirius).resolveVia).toBe('orb6_hip');
  });

  it('trusts an ORB6 HIP whose position is unknown', () => {
    const pair = wdsPair({ wdsId: '06451-1643', components: 'AB', precise: { raDeg: 101.3, decDeg: -16.7 } });
    const idx = indices({ hipToGaia: new Map([[32349, '2947050466531873024']]) });
    expect(resolveA(pair, [orb6(pair.wdsId, 'AB', 32349)], idx).resolveVia).toBe('orb6_hip');
  });

  it('prefers the cross-walk to a disagreeing AT-HYG gaia', () => {
    const pair = wdsPair({ components: 'AB' });
    const idx = indices({
      hipToGaia: new Map([[10, '100']]),
      athyg: [athygRow({ hip: 10, gaia: '999', raDeg: 100, decDeg: 0 })],
    });
    const r = resolveA(pair, [orb6(pair.wdsId, 'AB', 10)], idx);
    expect(r.resolveVia).toBe('orb6_hip');
    expect(r.gaiaSourceId).toBe('100');
  });

  it('keeps an unresolved primary\'s ORB6 HIP for Stage 3', () => {
    const pair = wdsPair({ wdsId: '06451-1643', components: 'AB' });
    const r = resolveA(pair, [orb6(pair.wdsId, 'AB', 32349)], indices());
    expect(r.resolveVia).toBe('unresolved');
    expect(r.gaiaSourceId).toBeNull();
    expect(r.hip).toBe(32349);
  });

  it('records the HIP of an orb6_hip binding', () => {
    const pair = wdsPair({ wdsId: 'W', components: 'AB' });
    const r = resolveA(pair, [orb6('W', 'AB', 42)], indices({ hipToGaia: new Map([[42, '100']]) }));
    expect(r).toMatchObject({ resolveVia: 'orb6_hip', gaiaSourceId: '100', hip: 42 });
  });
});

describe('groupOrb6ByPair', () => {
  it('keys strictly on the components field', () => {
    const ab = orb6('X', 'AB', 1);
    const ac = orb6('X', 'AC', 2);
    const sys = orb6('X', '', 3);
    const grouped = groupOrb6ByPair([ab, ac, sys]);
    expect(grouped.get(pairRowKey('X', 'AB'))).toEqual([ab]);
    expect(grouped.get(pairRowKey('X', 'AC'))).toEqual([ac]);
    expect(grouped.get(pairRowKey('X', ''))).toEqual([sys]);
  });
});

describe('resolveViaSimbad', () => {
  const one = (wdsId: string, comp: string, x: ReturnType<typeof xid>) => new Map([[componentKey(wdsId, comp), x]]);

  it('binds gaia and HIP when SIMBAD carries both', () => {
    const c = resolved({ wdsId: '00491+5749', discoverer: 'STF   60' });
    const [r] = resolveViaSimbad([c], one('00491+5749', 'A', xid('00491+5749', 'A', '425040000962559616', 3821)));
    expect(r).toMatchObject({ resolveVia: 'simbad_xid', gaiaSourceId: '425040000962559616', hip: 3821 });
  });

  it('binds the HIP alone when SIMBAD has no DR3 source (α Cen A)', () => {
    const c = resolved({ wdsId: '14396-6050', discoverer: 'RHD   1' });
    const [r] = resolveViaSimbad([c], one('14396-6050', 'A', xid('14396-6050', 'A', null, 71683)));
    expect(r).toMatchObject({ resolveVia: 'unresolved', gaiaSourceId: null, hip: 71683 });
  });

  it('leaves an already-bound component alone', () => {
    const c = resolved({ wdsId: 'X', discoverer: 'D', gaiaSourceId: '42', resolveVia: 'orb6_hip', hip: 99 });
    const [r] = resolveViaSimbad([c], one('X', 'A', xid('X', 'A', '999', 999)));
    expect(r).toMatchObject({ resolveVia: 'orb6_hip', gaiaSourceId: '42', hip: 99 });
  });

  it('does not override a HIP already carried', () => {
    const c = resolved({ wdsId: 'X', discoverer: 'D', hip: 32349 });
    const [r] = resolveViaSimbad([c], one('X', 'A', xid('X', 'A', null, 99)));
    expect(r).toMatchObject({ resolveVia: 'unresolved', hip: 32349 });
  });

  it('skips a component SIMBAD does not list', () => {
    const [r] = resolveViaSimbad([resolved({ wdsId: 'X', discoverer: 'D' })], new Map());
    expect(r).toMatchObject({ resolveVia: 'unresolved', gaiaSourceId: null, hip: null });
  });

  it('returns new records and leaves its input as it was', () => {
    const c = resolved({ wdsId: 'X' });
    const [r] = resolveViaSimbad([c], one('X', 'A', xid('X', 'A', '7')));
    expect(r.gaiaSourceId).toBe('7');
    expect(c.gaiaSourceId).toBeNull();
  });
});

describe('resolveViaCcdm', () => {
  it('binds the secondary to the CCDM sibling at its predicted position (α Cen)', () => {
    const pair = pairAt({ wdsId: '14396-6050', components: 'AB', ra: 100, dec: 0, rhoLast: 10, thetaLast: 0 });
    const idx = indices({
      athyg: [athygAt({ ra: 100, dec: 10 / 3600, gaia: '5877748442128924544', hip: 71681 })],
      ccdm: [{ hip: 71683, ccdm: '14396-6050' }, { hip: 71681, ccdm: '14396-6050' }],
    });
    const primary = resolved({ wdsId: pair.wdsId, discoverer: pair.discoverer, hip: 71683 });
    const secondary = resolved({ wdsId: pair.wdsId, discoverer: pair.discoverer, component: 'B', isPrimary: false });
    const { components: [p, s] } = resolveViaCcdm([primary, secondary], [pair], idx);
    expect(s).toMatchObject({ hip: 71681, gaiaSourceId: '5877748442128924544', resolveVia: 'ccdm_hip' });
    expect(p.hip).toBe(71683);
    expect(p.gaiaSourceId).toBeNull();
  });

  it('binds the primary to the one sibling near the pair coord', () => {
    const pair = pairAt({ wdsId: '00000+0000', components: 'AB', ra: 10, dec: 20 });
    const idx = indices({
      athyg: [athygAt({ ra: 10, dec: 20, hip: 42 })],
      ccdm: [{ hip: 42, ccdm: '00000+0000' }],
      hipToGaia: new Map([[42, '5000']]),
    });
    const { components: [r] } = resolveViaCcdm([resolved({ wdsId: pair.wdsId, discoverer: pair.discoverer })], [pair], idx);
    expect(r).toMatchObject({ hip: 42, gaiaSourceId: '5000', resolveVia: 'ccdm_hip' });
  });

  it('binds no secondary of a pair whose ρ overflowed', () => {
    const pair = pairAt({ wdsId: '14396-6050', components: 'AC', ra: 219.9021, dec: -60.834, rhoLast: null, thetaLast: 225 });
    const idx = indices({
      athyg: [athygAt({ ra: 219.9141, dec: -60.83948, gaia: '999', hip: 71681 })],
      ccdm: [{ hip: 71683, ccdm: '14396-6050' }, { hip: 71681, ccdm: '14396-6050' }],
    });
    const c = resolved({ wdsId: pair.wdsId, discoverer: pair.discoverer, component: 'C', isPrimary: false });
    const { components: [r] } = resolveViaCcdm([c], [pair], idx);
    expect(r.gaiaSourceId).toBeNull();
    expect(r.hip).toBeNull();
  });

  it('refuses a candidate a disjoint letter sits on, for both sides (Rigel)', () => {
    const ab = pairAt({ wdsId: '05145-0812', components: 'AB', ra: 100, dec: 0, rhoLast: 9.4, thetaLast: 180 });
    const bc = pairAt({ wdsId: '05145-0812', components: 'BC', ra: 100, dec: -9.4 / 3600, rhoLast: 0.1, thetaLast: 30 });
    const idx = indices({
      athyg: [athygAt({ ra: 100, dec: 0, hip: 24436 })],
      ccdm: [{ hip: 24436, ccdm: '05145-0812' }],
      hipToGaia: new Map([[24436, '7777']]),
    });
    const b = resolved({ wdsId: bc.wdsId, discoverer: bc.discoverer, component: 'B' });
    const c = resolved({ wdsId: bc.wdsId, discoverer: bc.discoverer, component: 'C', isPrimary: false });
    const r = resolveViaCcdm([b, c], [ab, bc], idx);
    expect(r.components[0]).toMatchObject({ hip: null, gaiaSourceId: null, resolveVia: 'unresolved' });
    expect(r.components[1]).toMatchObject({ hip: null, gaiaSourceId: null });
    expect(r.rejected.filter((x) => x.tier === 'ccdm_sibling_owned')).toHaveLength(2);
  });

  it('never refuses for the pair partner (σ Ori blend convention)', () => {
    const pair = pairAt({ wdsId: '00000+0000', components: 'AB', ra: 100, dec: 0, rhoLast: 2, thetaLast: 180 });
    const idx = indices({ athyg: [athygAt({ ra: 100, dec: -1.2 / 3600, hip: 99 })], ccdm: [{ hip: 99, ccdm: '00000+0000' }] });
    const s = resolved({ wdsId: pair.wdsId, discoverer: pair.discoverer, component: 'B', isPrimary: false });
    const r = resolveViaCcdm([s], [pair], idx);
    expect(r.components[0].hip).toBe(99);
    expect(r.rejected).toHaveLength(0);
  });

  it('lets a near-tie with a non-partner letter stand', () => {
    const ab = pairAt({ wdsId: '00000+0000', components: 'AB', ra: 100, dec: 0, rhoLast: 2, thetaLast: 180 });
    const ac = pairAt({ wdsId: '00000+0000', components: 'AC', ra: 100, dec: 0, rhoLast: 2.4, thetaLast: 180 });
    const idx = indices({ athyg: [athygAt({ ra: 100, dec: -2.2 / 3600, hip: 99 })], ccdm: [{ hip: 99, ccdm: '00000+0000' }] });
    const s = resolved({ wdsId: ac.wdsId, discoverer: ac.discoverer, component: 'C', isPrimary: false });
    const r = resolveViaCcdm([s], [ab, ac], idx);
    expect(r.components[0].hip).toBe(99);
    expect(r.rejected).toHaveLength(0);
  });

  it('refuses a HIP another letter already binds, even at the system coordinate', () => {
    const aBc = pairAt({ wdsId: '05145-0812', components: 'A,BC', ra: 100, dec: 0, rhoLast: 9.4, thetaLast: 204 });
    const bc = pairAt({ wdsId: '05145-0812', components: 'BC', ra: 100, dec: 0, rhoLast: 0.1, thetaLast: 30 });
    const idx = indices({
      athyg: [athygAt({ ra: 100, dec: 0, hip: 24436 })],
      ccdm: [{ hip: 24436, ccdm: '05145-0812' }],
      hipToGaia: new Map([[24436, '7777']]),
    });
    const a = resolved({ wdsId: aBc.wdsId, discoverer: aBc.discoverer, hip: 24436 });
    const b = resolved({ wdsId: bc.wdsId, discoverer: bc.discoverer, component: 'B' });
    const r = resolveViaCcdm([a, b], [aBc, bc], idx);
    expect(r.components[1]).toMatchObject({ hip: null, gaiaSourceId: null });
    expect(r.rejected).toHaveLength(1);
  });

  it('skips a system with no CCDM candidates', () => {
    const pair = pairAt({ wdsId: 'UNKNOWN', components: 'AB', ra: 0, dec: 0 });
    const { components: [r] } = resolveViaCcdm([resolved({ wdsId: 'UNKNOWN', discoverer: pair.discoverer })], [pair], indices());
    expect(r).toMatchObject({ resolveVia: 'unresolved', gaiaSourceId: null });
  });

  it('PM-propagates a high-PM sibling\'s stored position before matching', () => {
    const pair = pairAt({ wdsId: '00000+0000', components: 'AB', ra: 100, dec: 0 });
    const idx = indices({
      athyg: [athygAt({ ra: 100 + 30 / 3600, dec: 0, hip: 42, pmRaMasyr: -3428.6, pmDecMasyr: 0 })],
      ccdm: [{ hip: 42, ccdm: '00000+0000' }],
      hipToGaia: new Map([[42, '5000']]),
    });
    const { components: [r] } = resolveViaCcdm([resolved({ wdsId: pair.wdsId, discoverer: pair.discoverer })], [pair], idx);
    expect(r).toMatchObject({ hip: 42, gaiaSourceId: '5000', resolveVia: 'ccdm_hip' });
  });

  it('prefers a carried HIP among the candidates over a position match', () => {
    const pair = pairAt({ wdsId: '00000+0000', components: 'AB', ra: 100, dec: 0 });
    const idx = indices({
      athyg: [athygAt({ ra: 100, dec: 0, gaia: '8000', hip: 8 }), athygAt({ ra: 100, dec: 0, gaia: '9000', hip: 9 })],
      ccdm: [{ hip: 8, ccdm: '00000+0000' }, { hip: 9, ccdm: '00000+0000' }],
    });
    const { components: [r] } = resolveViaCcdm([resolved({ wdsId: pair.wdsId, discoverer: pair.discoverer, hip: 9 })], [pair], idx);
    expect(r).toMatchObject({ hip: 9, gaiaSourceId: '9000', resolveVia: 'ccdm_hip' });
  });
});

describe('buildSystemLetterPositions', () => {
  it('upgrades a predicted letter to a primary slot\'s measured coord', () => {
    const ab = pairAt({ wdsId: '05145-0812', components: 'AB', ra: 100, dec: 0, rhoLast: 9.4, thetaLast: 180 });
    const bc = pairAt({ wdsId: '05145-0812', components: 'BC', ra: 100, dec: -9.5 / 3600, rhoLast: 0.1, thetaLast: 30 });
    const letters = buildSystemLetterPositions([ab, bc]).get('05145-0812')!;
    expect(letters.get('B')).toEqual({ raDeg: 100, decDeg: -9.5 / 3600 });
    expect(letters.get('A')).toEqual({ raDeg: 100, decDeg: 0 });
    expect(letters.has('C')).toBe(true);
  });
});

describe('resolveViaPosition', () => {
  it('binds a primary to the AT-HYG row at its coord', () => {
    const pair = pairAt({ components: 'Ca,Cb', ra: 217.4296, dec: -62.6795 });
    const athyg = [athygAt({ ra: 217.4296, dec: -62.6795, gaia: '5853498713190525696' })];
    const c = resolved({ wdsId: pair.wdsId, discoverer: pair.discoverer, component: 'Ca' });
    const { components: [r] } = resolveViaPosition([c], [pair], athyg);
    expect(r).toMatchObject({ resolveVia: 'athyg_gaia_native', gaiaSourceId: '5853498713190525696' });
  });

  it('binds a secondary at its predicted position', () => {
    const pair = pairAt({ components: 'AB', ra: 100, dec: 0, rhoLast: 360, thetaLast: 0 });
    const athyg = [athygAt({ ra: 100, dec: 0, gaia: '111' }), athygAt({ ra: 100, dec: 0.1, gaia: '222' })];
    const comps = [
      resolved({ wdsId: pair.wdsId, discoverer: pair.discoverer }),
      resolved({ wdsId: pair.wdsId, discoverer: pair.discoverer, component: 'B', isPrimary: false }),
    ];
    const { components: [p, s] } = resolveViaPosition(comps, [pair], athyg);
    expect(p.gaiaSourceId).toBe('111');
    expect(s).toMatchObject({ gaiaSourceId: '222', resolveVia: 'athyg_gaia_native' });
  });

  it('leaves a bound component alone', () => {
    const pair = pairAt({ components: 'AB', ra: 100, dec: 0 });
    const c = resolved({ wdsId: pair.wdsId, discoverer: pair.discoverer, gaiaSourceId: '100', resolveVia: 'orb6_hip' });
    const { components: [r] } = resolveViaPosition([c], [pair], [athygAt({ ra: 100, dec: 0, gaia: '999' })]);
    expect(r).toMatchObject({ resolveVia: 'orb6_hip', gaiaSourceId: '100' });
  });

  it('invents no gaia when the matched row has none', () => {
    const pair = pairAt({ components: 'AB', ra: 100, dec: 0 });
    const { components: [r] } = resolveViaPosition(
      [resolved({ wdsId: pair.wdsId, discoverer: pair.discoverer })], [pair], [athygAt({ ra: 100, dec: 0 })],
    );
    expect(r).toMatchObject({ resolveVia: 'unresolved', gaiaSourceId: null });
  });

  it('refuses a row whose HIP a disjoint letter binds (Rigel)', () => {
    const bc = pairAt({ wdsId: '05145-0812', components: 'BC', ra: 100, dec: 0, rhoLast: 0.1, thetaLast: 30 });
    const athyg = [athygAt({ ra: 100, dec: 0, gaia: '555', hip: 24436 })];
    const a = resolved({ wdsId: '05145-0812', discoverer: bc.discoverer, hip: 24436 });
    const b = resolved({ wdsId: '05145-0812', discoverer: bc.discoverer, component: 'B' });
    const r = resolveViaPosition([a, b], [bc], athyg);
    expect(r.components[1]).toMatchObject({ hip: null, gaiaSourceId: null, resolveVia: 'unresolved' });
    expect(r.rejected.filter((x) => x.tier === 'athyg_match_sibling_claimed')).toHaveLength(1);
  });

  it('lets a letter match a row carrying its own HIP', () => {
    const pair = pairAt({ wdsId: '00000+0000', components: 'AB', ra: 100, dec: 0, rhoLast: 0.5, thetaLast: 0 });
    const a = resolved({ wdsId: pair.wdsId, discoverer: pair.discoverer, hip: 42 });
    const r = resolveViaPosition([a], [pair], [athygAt({ ra: 100, dec: 0, gaia: '555', hip: 42 })]);
    expect(r.components[0]).toMatchObject({ gaiaSourceId: '555', resolveVia: 'athyg_gaia_native' });
    expect(r.rejected).toHaveLength(0);
  });

  it('PM-propagates a high-PM row before the 2″ match (α Cen A)', () => {
    const pair = pairAt({ wdsId: '14396-6050', components: 'AB', ra: 219.9021, dec: -60.834 });
    const athyg = [athygAt({
      ra: 219.92041, dec: -60.83515, gaia: '5877748442128924544', hip: 71683, pmRaMasyr: -3678.19, pmDecMasyr: 481.84,
    })];
    const { components: [r] } = resolveViaPosition([resolved({ wdsId: pair.wdsId, discoverer: pair.discoverer })], [pair], athyg);
    expect(r).toMatchObject({ gaiaSourceId: '5877748442128924544', hip: 71683, resolveVia: 'athyg_gaia_native' });
  });

  it('predicts no secondary position when ρ overflowed', () => {
    const pair = pairAt({ wdsId: 'X', components: 'AC', ra: 100, dec: 0, rhoLast: null, thetaLast: 225 });
    const c = resolved({ wdsId: 'X', discoverer: pair.discoverer, component: 'C', isPrimary: false });
    const { components: [r] } = resolveViaPosition([c], [pair], [athygAt({ ra: 99.96, dec: -0.04, gaia: '777' })]);
    expect(r).toMatchObject({ resolveVia: 'unresolved', gaiaSourceId: null });
  });

  it('records the matched row\'s HIP', () => {
    const pair = pairAt({ components: 'AB', ra: 100, dec: 0 });
    const { components: [r] } = resolveViaPosition(
      [resolved({ wdsId: pair.wdsId, discoverer: pair.discoverer })], [pair], [athygAt({ ra: 100, dec: 0, hip: 99, gaia: '42' })],
    );
    expect(r).toMatchObject({ gaiaSourceId: '42', hip: 99 });
  });
});
