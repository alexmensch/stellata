import { describe, expect, it } from 'vitest';

import { componentKey, pairRowKey } from '../component-tokens-pure';
import { orb6Entry, wdsPair } from '../../wds/wds-fixture';
import { athygRow } from '../load/load-fixture';
import type { Orb6Entry, WdsPair } from '../../wds/wds-pure';
import {
  buildSystemLetterPositions, groupOrb6ByPair, resolveComponent, resolveViaCcdm, resolveViaPosition, resolveViaSimbad,
} from './cascade-pure';
import { componentsOf } from './components-pure';
import { alone, athygAt, decomposed, indices, lone, pairAt, resolved, xid } from './resolve-fixture';

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
  const run = (c: ReturnType<typeof resolved>, xids: ReturnType<typeof one> | Map<never, never>) => lone(resolveViaSimbad([alone(c)], xids))[0];

  it('binds gaia and HIP when SIMBAD carries both', () => {
    const r = run(resolved({ wdsId: '00491+5749', discoverer: 'STF   60' }), one('00491+5749', 'A', xid('00491+5749', 'A', '425040000962559616', 3821)));
    expect(r).toMatchObject({ resolveVia: 'simbad_xid', gaiaSourceId: '425040000962559616', hip: 3821 });
  });

  it('binds the HIP alone when SIMBAD has no DR3 source (α Cen A)', () => {
    const r = run(resolved({ wdsId: '14396-6050', discoverer: 'RHD   1' }), one('14396-6050', 'A', xid('14396-6050', 'A', null, 71683)));
    expect(r).toMatchObject({ resolveVia: 'unresolved', gaiaSourceId: null, hip: 71683 });
  });

  it('leaves an already-bound component alone', () => {
    const r = run(resolved({ wdsId: 'X', discoverer: 'D', gaiaSourceId: '42', resolveVia: 'orb6_hip', hip: 99 }), one('X', 'A', xid('X', 'A', '999', 999)));
    expect(r).toMatchObject({ resolveVia: 'orb6_hip', gaiaSourceId: '42', hip: 99 });
  });

  it('does not override a HIP already carried', () => {
    const r = run(resolved({ wdsId: 'X', discoverer: 'D', hip: 32349 }), one('X', 'A', xid('X', 'A', null, 99)));
    expect(r).toMatchObject({ resolveVia: 'unresolved', hip: 32349 });
  });

  it('skips a component SIMBAD does not list', () => {
    expect(run(resolved({ wdsId: 'X', discoverer: 'D' }), new Map())).toMatchObject({ resolveVia: 'unresolved', gaiaSourceId: null, hip: null });
  });

  it('returns new records and leaves its input as it was', () => {
    const input = [alone(resolved({ wdsId: 'X' }))];
    expect(lone(resolveViaSimbad(input, one('X', 'A', xid('X', 'A', '7'))))[0].gaiaSourceId).toBe('7');
    expect(input[0].primary.gaiaSourceId).toBeNull();
  });
});

describe('resolveViaCcdm', () => {
  it('binds the secondary to the CCDM sibling at its predicted position (α Cen)', () => {
    const pair = pairAt({ wdsId: '14396-6050', components: 'AB', ra: 100, dec: 0, rhoLast: 10, thetaLast: 0 });
    const idx = indices({
      athyg: [athygAt({ ra: 100, dec: 10 / 3600, gaia: '5877748442128924544', hip: 71681 })],
      ccdm: [{ hip: 71683, ccdm: '14396-6050' }, { hip: 71681, ccdm: '14396-6050' }],
    });
    const { pairs: [r] } = resolveViaCcdm([decomposed(pair, { primary: { hip: 71683 }, secondary: {} })], idx);
    expect(r.secondary).toMatchObject({ hip: 71681, gaiaSourceId: '5877748442128924544', resolveVia: 'ccdm_hip' });
    expect(r.primary.hip).toBe(71683);
    expect(r.primary.gaiaSourceId).toBeNull();
  });

  it('binds the primary to the one sibling near the pair coord', () => {
    const pair = pairAt({ wdsId: '00000+0000', components: 'AB', ra: 10, dec: 20 });
    const idx = indices({
      athyg: [athygAt({ ra: 10, dec: 20, hip: 42 })],
      ccdm: [{ hip: 42, ccdm: '00000+0000' }],
      hipToGaia: new Map([[42, '5000']]),
    });
    const { pairs: [r] } = resolveViaCcdm([decomposed(pair, { primary: {} })], idx);
    expect(r.primary).toMatchObject({ hip: 42, gaiaSourceId: '5000', resolveVia: 'ccdm_hip' });
  });

  it('binds no secondary of a pair whose ρ overflowed', () => {
    const pair = pairAt({ wdsId: '14396-6050', components: 'AC', ra: 219.9021, dec: -60.834, rhoLast: null, thetaLast: 225 });
    const idx = indices({
      athyg: [athygAt({ ra: 219.9141, dec: -60.83948, gaia: '999', hip: 71681 })],
      ccdm: [{ hip: 71683, ccdm: '14396-6050' }, { hip: 71681, ccdm: '14396-6050' }],
    });
    const { pairs: [r] } = resolveViaCcdm([decomposed(pair, { secondary: {} })], idx);
    expect(r.secondary).toMatchObject({ gaiaSourceId: null, hip: null });
  });

  it('refuses a candidate a disjoint letter sits on, for both sides (Rigel)', () => {
    const ab = pairAt({ wdsId: '05145-0812', components: 'AB', ra: 100, dec: 0, rhoLast: 9.4, thetaLast: 180 });
    const bc = pairAt({ wdsId: '05145-0812', components: 'BC', ra: 100, dec: -9.4 / 3600, rhoLast: 0.1, thetaLast: 30 });
    const idx = indices({
      athyg: [athygAt({ ra: 100, dec: 0, hip: 24436 })],
      ccdm: [{ hip: 24436, ccdm: '05145-0812' }],
      hipToGaia: new Map([[24436, '7777']]),
    });
    const r = resolveViaCcdm([decomposed(ab), decomposed(bc, { primary: {}, secondary: {} })], idx);
    expect(r.pairs[1].primary).toMatchObject({ hip: null, gaiaSourceId: null, resolveVia: 'unresolved' });
    expect(r.pairs[1].secondary).toMatchObject({ hip: null, gaiaSourceId: null });
    expect(r.rejected.filter((x) => x.tier === 'ccdm_sibling_owned')).toHaveLength(2);
  });

  it('never refuses for the pair partner (σ Ori blend convention)', () => {
    const pair = pairAt({ wdsId: '00000+0000', components: 'AB', ra: 100, dec: 0, rhoLast: 2, thetaLast: 180 });
    const idx = indices({ athyg: [athygAt({ ra: 100, dec: -1.2 / 3600, hip: 99 })], ccdm: [{ hip: 99, ccdm: '00000+0000' }] });
    const r = resolveViaCcdm([decomposed(pair, { secondary: {} })], idx);
    expect(r.pairs[0].secondary.hip).toBe(99);
    expect(r.rejected).toHaveLength(0);
  });

  it('lets a near-tie with a non-partner letter stand', () => {
    const ab = pairAt({ wdsId: '00000+0000', components: 'AB', ra: 100, dec: 0, rhoLast: 2, thetaLast: 180 });
    const ac = pairAt({ wdsId: '00000+0000', components: 'AC', ra: 100, dec: 0, rhoLast: 2.4, thetaLast: 180 });
    const idx = indices({ athyg: [athygAt({ ra: 100, dec: -2.2 / 3600, hip: 99 })], ccdm: [{ hip: 99, ccdm: '00000+0000' }] });
    const r = resolveViaCcdm([decomposed(ab), decomposed(ac, { secondary: {} })], idx);
    expect(r.pairs[1].secondary.hip).toBe(99);
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
    const r = resolveViaCcdm([decomposed(aBc, { primary: { hip: 24436 } }), decomposed(bc, { primary: {} })], idx);
    expect(r.pairs[1].primary).toMatchObject({ hip: null, gaiaSourceId: null });
    expect(r.rejected).toHaveLength(1);
  });

  it('skips a system with no CCDM candidates', () => {
    const pair = pairAt({ wdsId: 'UNKNOWN', components: 'AB', ra: 0, dec: 0 });
    const { pairs: [r] } = resolveViaCcdm([decomposed(pair, { primary: {} })], indices());
    expect(r.primary).toMatchObject({ resolveVia: 'unresolved', gaiaSourceId: null });
  });

  it('PM-propagates a high-PM sibling\'s stored position before matching', () => {
    const pair = pairAt({ wdsId: '00000+0000', components: 'AB', ra: 100, dec: 0 });
    const idx = indices({
      athyg: [athygAt({ ra: 100 + 30 / 3600, dec: 0, hip: 42, pmRaMasyr: -3428.6, pmDecMasyr: 0 })],
      ccdm: [{ hip: 42, ccdm: '00000+0000' }],
      hipToGaia: new Map([[42, '5000']]),
    });
    const { pairs: [r] } = resolveViaCcdm([decomposed(pair, { primary: {} })], idx);
    expect(r.primary).toMatchObject({ hip: 42, gaiaSourceId: '5000', resolveVia: 'ccdm_hip' });
  });

  it('prefers a carried HIP among the candidates over a position match', () => {
    const pair = pairAt({ wdsId: '00000+0000', components: 'AB', ra: 100, dec: 0 });
    const idx = indices({
      athyg: [athygAt({ ra: 100, dec: 0, gaia: '8000', hip: 8 }), athygAt({ ra: 100, dec: 0, gaia: '9000', hip: 9 })],
      ccdm: [{ hip: 8, ccdm: '00000+0000' }, { hip: 9, ccdm: '00000+0000' }],
    });
    const { pairs: [r] } = resolveViaCcdm([decomposed(pair, { primary: { hip: 9 } })], idx);
    expect(r.primary).toMatchObject({ hip: 9, gaiaSourceId: '9000', resolveVia: 'ccdm_hip' });
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
    const { pairs: [r] } = resolveViaPosition([decomposed(pair, { primary: {} })], athyg);
    expect(r.primary).toMatchObject({ resolveVia: 'athyg_gaia_native', gaiaSourceId: '5853498713190525696' });
  });

  it('binds a secondary at its predicted position', () => {
    const pair = pairAt({ components: 'AB', ra: 100, dec: 0, rhoLast: 360, thetaLast: 0 });
    const athyg = [athygAt({ ra: 100, dec: 0, gaia: '111' }), athygAt({ ra: 100, dec: 0.1, gaia: '222' })];
    const { pairs: [r] } = resolveViaPosition([decomposed(pair, { primary: {}, secondary: {} })], athyg);
    expect(r.primary.gaiaSourceId).toBe('111');
    expect(r.secondary).toMatchObject({ gaiaSourceId: '222', resolveVia: 'athyg_gaia_native' });
  });

  it('leaves a bound component alone', () => {
    const pair = pairAt({ components: 'AB', ra: 100, dec: 0 });
    const { pairs: [r] } = resolveViaPosition(
      [decomposed(pair, { primary: { gaiaSourceId: '100', resolveVia: 'orb6_hip' } })], [athygAt({ ra: 100, dec: 0, gaia: '999' })],
    );
    expect(r.primary).toMatchObject({ resolveVia: 'orb6_hip', gaiaSourceId: '100' });
  });

  it('invents no gaia when the matched row has none', () => {
    const pair = pairAt({ components: 'AB', ra: 100, dec: 0 });
    const { pairs: [r] } = resolveViaPosition([decomposed(pair, { primary: {} })], [athygAt({ ra: 100, dec: 0 })]);
    expect(r.primary).toMatchObject({ resolveVia: 'unresolved', gaiaSourceId: null });
  });

  it('refuses a row whose HIP a disjoint letter binds (Rigel)', () => {
    const ad = pairAt({ wdsId: '05145-0812', components: 'AD' });
    const bc = pairAt({ wdsId: '05145-0812', components: 'BC', ra: 100, dec: 0, rhoLast: 0.1, thetaLast: 30 });
    const athyg = [athygAt({ ra: 100, dec: 0, gaia: '555', hip: 24436 })];
    const r = resolveViaPosition([decomposed(ad, { primary: { hip: 24436 } }), decomposed(bc, { primary: {} })], athyg);
    expect(r.pairs[1].primary).toMatchObject({ hip: null, gaiaSourceId: null, resolveVia: 'unresolved' });
    expect(r.rejected.filter((x) => x.tier === 'athyg_match_sibling_claimed')).toHaveLength(1);
  });

  it('lets a letter match a row carrying its own HIP', () => {
    const pair = pairAt({ wdsId: '00000+0000', components: 'AB', ra: 100, dec: 0, rhoLast: 0.5, thetaLast: 0 });
    const r = resolveViaPosition([decomposed(pair, { primary: { hip: 42 } })], [athygAt({ ra: 100, dec: 0, gaia: '555', hip: 42 })]);
    expect(r.pairs[0].primary).toMatchObject({ gaiaSourceId: '555', resolveVia: 'athyg_gaia_native' });
    expect(r.rejected).toHaveLength(0);
  });

  it('PM-propagates a high-PM row before the 2″ match (α Cen A)', () => {
    const pair = pairAt({ wdsId: '14396-6050', components: 'AB', ra: 219.9021, dec: -60.834 });
    const athyg = [athygAt({
      ra: 219.92041, dec: -60.83515, gaia: '5877748442128924544', hip: 71683, pmRaMasyr: -3678.19, pmDecMasyr: 481.84,
    })];
    const { pairs: [r] } = resolveViaPosition([decomposed(pair, { primary: {} })], athyg);
    expect(r.primary).toMatchObject({ gaiaSourceId: '5877748442128924544', hip: 71683, resolveVia: 'athyg_gaia_native' });
  });

  it('predicts no secondary position when ρ overflowed', () => {
    const pair = pairAt({ wdsId: 'X', components: 'AC', ra: 100, dec: 0, rhoLast: null, thetaLast: 225 });
    const { pairs: [r] } = resolveViaPosition([decomposed(pair, { secondary: {} })], [athygAt({ ra: 99.96, dec: -0.04, gaia: '777' })]);
    expect(r.secondary).toMatchObject({ resolveVia: 'unresolved', gaiaSourceId: null });
  });

  it('records the matched row\'s HIP', () => {
    const pair = pairAt({ components: 'AB', ra: 100, dec: 0 });
    const { pairs } = resolveViaPosition([decomposed(pair, { primary: {} })], [athygAt({ ra: 100, dec: 0, hip: 99, gaia: '42' })]);
    expect(componentsOf(pairs)[0]).toMatchObject({ gaiaSourceId: '42', hip: 99 });
  });
});
