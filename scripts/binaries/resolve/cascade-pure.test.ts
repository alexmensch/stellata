import { describe, expect, it } from 'vitest';

import { componentKey, pairRowKey } from '../component-tokens-pure';
import { orb6Entry, wdsPair } from '../../wds/wds-fixture';
import type { Orb6Entry, WdsPair } from '../../wds/wds-pure';
import {
  buildSystemLetterPositions, groupOrb6ByPair, resolveComponent, resolveViaCcdm, resolveViaPosition, resolveViaSimbad,
} from './cascade-pure';
import { componentsOf, resolveViaOf } from './components-pure';
import { alone, decomposed, hip2At, indices, lone, pairAt, ids, resolved, starAt, xid } from './resolve-fixture';
import { OWN } from '../multiples-record-pure';
import { simbadSourceLetters, type SimbadSourceLetters } from './sibling-identity-pure';

const orb6 = (wdsId: string, components: string, hip: number | null): Orb6Entry =>
  orb6Entry({ wdsId, components, hip, grade: 5 });

describe('resolveComponent', () => {
  const resolveA = (
    pair: WdsPair, entries: Orb6Entry[], idx: ReturnType<typeof indices>, isPrimary = true, comp = 'A',
    letters: SimbadSourceLetters = new Map(),
  ) => resolveComponent(pair, comp, isPrimary, entries, idx, letters).component;

  it('binds the primary through ORB6\'s HIP and the Gaia cross-walk', () => {
    const pair = wdsPair({ wdsId: '06451-1643', components: 'AB' });
    const r = resolveA(pair, [orb6('06451-1643', 'AB', 32349)], indices({ hipToGaia: new Map([[32349, '2947050466531873024']]) }));
    expect(resolveViaOf(r)).toBe('orb6_hip');
    expect(r.gaia?.value).toBe('2947050466531873024');
  });

  it('never fires orb6_hip for a secondary', () => {
    const pair = wdsPair({ components: 'AB' });
    const r = resolveA(pair, [orb6(pair.wdsId, 'AB', 100)], indices({ hipToGaia: new Map([[100, '999']]) }), false, 'B');
    expect(resolveViaOf(r)).toBe('unresolved');
    expect(r.gaia).toBeNull();
  });

  it('falls to the manifest\'s derived source when the cross-walk misses the ORB6 HIP', () => {
    const pair = wdsPair({ components: 'AB' });
    const idx = indices({ hipToManifestGaia: new Map([[42, '12345']]) });
    const r = resolveA(pair, [orb6(pair.wdsId, 'AB', 42)], idx);
    expect(resolveViaOf(r)).toBe('manifest_hip');
    expect(r.gaia?.value).toBe('12345');
  });

  describe('the manifest route refuses a source SIMBAD gives a hierarchy-disjoint letter (53 Aqr)', () => {
    const pair = wdsPair({ wdsId: '22266-1645', components: 'AB' });
    const idx = indices({ hipToManifestGaia: new Map([[110778, '2595463996992115840']]) });
    const bOwnsIt = simbadSourceLetters(new Map([
      [componentKey('22266-1645', 'B'), xid('22266-1645', 'B', '2595463996992115840')],
    ]));

    it('leaves A unbound, keeps the HIP for later passes, and records the refusal', () => {
      const r = resolveComponent(pair, 'A', true, [orb6(pair.wdsId, 'AB', 110778)], idx, bOwnsIt);
      expect(resolveViaOf(r.component)).toBe('unresolved');
      expect(r.component.hip?.value).toBe(110778);
      expect(r.refused).toEqual([{ gate: 'manifest_hip_sibling_claimed', pair, component: 'A', hip: 110778 }]);
    });

    it.each([
      ['the letter SIMBAD names', 'B', 'B'],
      ['a sub-letter of it', 'B', 'Ba'],
      ['a compound holding it', 'B', 'AB'],
      ['a digit-only token, which carries no lineage', 'B', '2'],
    ])('binds %s', (_case, simbadLetter, comp) => {
      const letters = simbadSourceLetters(new Map([
        [componentKey('22266-1645', simbadLetter), xid('22266-1645', simbadLetter, '2595463996992115840')],
      ]));
      const r = resolveA(pair, [orb6(pair.wdsId, 'AB', 110778)], idx, true, comp, letters);
      expect(resolveViaOf(r)).toBe('manifest_hip');
    });
  });

  it('is unresolved with no HIP signal', () => {
    const r = resolveA(wdsPair({ components: 'AB' }), [], indices({ hipToGaia: new Map([[1, '1']]) }));
    expect(resolveViaOf(r)).toBe('unresolved');
    expect(r.gaia).toBeNull();
  });

  it('drops an ORB6 HIP whose position is far off the pair coord, HIP and all (ε Equ)', () => {
    const pair = wdsPair({ wdsId: '20591+0418', components: 'Aa,Ab', precise: { raDeg: 315.0, decDeg: 4.3 } });
    const idx = indices({
      hipToGaia: new Map([[103579, '2018523585846555648']]),
      hip2: hip2At({ hip: 103579, ra: 315.4, dec: 44.1 }),
    });
    const r = resolveA(pair, [orb6(pair.wdsId, 'Aa,Ab', 103579)], idx, true, 'Aa');
    expect(resolveViaOf(r)).toBe('unresolved');
    expect(r.gaia).toBeNull();
    expect(r.hip).toBeNull();
    const twice = [orb6(pair.wdsId, 'Aa,Ab', 103579), orb6(pair.wdsId, 'Aa,Ab', 103579)];
    expect(resolveComponent(pair, 'Aa', true, twice, idx, new Map()).refused)
      .toEqual([{ gate: 'orb6_hip_off_coord', pair, component: 'Aa', hip: 103579 }]);
  });

  const sirius = indices({
    hipToGaia: new Map([[32349, '2947050466531873024']]),
    hip2: hip2At({ hip: 32349, ra: 101.3, dec: -16.7 }),
  });

  it('trusts an ORB6 HIP sitting on the pair coord', () => {
    const pair = wdsPair({ wdsId: '06451-1643', components: 'AB', precise: { raDeg: 101.3, decDeg: -16.7 } });
    const r = resolveA(pair, [orb6(pair.wdsId, 'AB', 32349)], sirius);
    expect(resolveViaOf(r)).toBe('orb6_hip');
    expect(r.gaia?.value).toBe('2947050466531873024');
  });

  it('trusts an ORB6 HIP when the pair has no precise coord', () => {
    const pair = wdsPair({ wdsId: '06451-1643', components: 'AB', precise: null });
    expect(resolveViaOf(resolveA(pair, [orb6(pair.wdsId, 'AB', 32349)], sirius))).toBe('orb6_hip');
  });

  it('trusts an ORB6 HIP whose position is unknown', () => {
    const pair = wdsPair({ wdsId: '06451-1643', components: 'AB', precise: { raDeg: 101.3, decDeg: -16.7 } });
    const idx = indices({ hipToGaia: new Map([[32349, '2947050466531873024']]) });
    expect(resolveViaOf(resolveA(pair, [orb6(pair.wdsId, 'AB', 32349)], idx))).toBe('orb6_hip');
  });

  it('prefers the cross-walk to a disagreeing manifest source', () => {
    const pair = wdsPair({ components: 'AB' });
    const idx = indices({ hipToGaia: new Map([[10, '100']]), hipToManifestGaia: new Map([[10, '999']]) });
    const r = resolveA(pair, [orb6(pair.wdsId, 'AB', 10)], idx);
    expect(resolveViaOf(r)).toBe('orb6_hip');
    expect(r.gaia?.value).toBe('100');
  });

  it('keeps an unresolved primary\'s ORB6 HIP for Stage 3', () => {
    const pair = wdsPair({ wdsId: '06451-1643', components: 'AB' });
    const r = resolveA(pair, [orb6(pair.wdsId, 'AB', 32349)], indices());
    expect(resolveViaOf(r)).toBe('unresolved');
    expect(r.gaia).toBeNull();
    expect(r.hip?.value).toBe(32349);
  });

  it('records the HIP of an orb6_hip binding', () => {
    const pair = wdsPair({ wdsId: 'W', components: 'AB' });
    const r = resolveA(pair, [orb6('W', 'AB', 42)], indices({ hipToGaia: new Map([[42, '100']]) }));
    expect(ids(r)).toMatchObject({ resolveVia: 'orb6_hip', gaiaSourceId: '100', hip: 42 });
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
    expect(ids(r)).toMatchObject({ resolveVia: 'simbad_xid', gaiaSourceId: '425040000962559616', hip: 3821 });
    expect([r.gaia?.origin, r.hip?.origin]).toEqual([OWN, OWN]);
  });

  it('binds the HIP alone when SIMBAD has no DR3 source (α Cen A)', () => {
    const r = run(resolved({ wdsId: '14396-6050', discoverer: 'RHD   1' }), one('14396-6050', 'A', xid('14396-6050', 'A', null, 71683)));
    expect(ids(r)).toMatchObject({ resolveVia: 'unresolved', gaiaSourceId: null, hip: 71683 });
  });

  it('leaves an already-bound component alone', () => {
    const r = run(resolved({ wdsId: 'X', discoverer: 'D', gaiaSourceId: '42', resolveVia: 'orb6_hip', hip: 99 }), one('X', 'A', xid('X', 'A', '999', 999)));
    expect(ids(r)).toMatchObject({ resolveVia: 'orb6_hip', gaiaSourceId: '42', hip: 99 });
  });

  it('does not override a HIP already carried', () => {
    const r = run(resolved({ wdsId: 'X', discoverer: 'D', hip: 32349 }), one('X', 'A', xid('X', 'A', null, 99)));
    expect(ids(r)).toMatchObject({ resolveVia: 'unresolved', hip: 32349 });
  });

  it('skips a component SIMBAD does not list', () => {
    expect(ids(run(resolved({ wdsId: 'X', discoverer: 'D' }), new Map()))).toMatchObject({ resolveVia: 'unresolved', gaiaSourceId: null, hip: null });
  });

  it('returns new records and leaves its input as it was', () => {
    const input = [alone(resolved({ wdsId: 'X' }))];
    expect(lone(resolveViaSimbad(input, one('X', 'A', xid('X', 'A', '7'))))[0].gaia?.value).toBe('7');
    expect(input[0].primary.gaia).toBeNull();
  });
});

describe('resolveViaCcdm', () => {
  it('binds the secondary to the CCDM sibling at its predicted position (α Cen)', () => {
    const pair = pairAt({ wdsId: '14396-6050', components: 'AB', ra: 100, dec: 0, rhoLast: 10, thetaLast: 0 });
    const idx = indices({
      hip2: hip2At({ hip: 71681, ra: 100, dec: 10 / 3600 }),
      hipToManifestGaia: new Map([[71681, '5877748442128924544']]),
      ccdm: [{ hip: 71683, ccdm: '14396-6050' }, { hip: 71681, ccdm: '14396-6050' }],
    });
    const { pairs: [r] } = resolveViaCcdm([decomposed(pair, { primary: { hip: 71683 }, secondary: {} })], idx);
    expect(ids(r.secondary)).toMatchObject({ hip: 71681, gaiaSourceId: '5877748442128924544', resolveVia: 'ccdm_hip' });
    expect(r.primary.hip?.value).toBe(71683);
    expect(r.primary.gaia).toBeNull();
  });

  it('binds the primary to the one sibling near the pair coord', () => {
    const pair = pairAt({ wdsId: '00000+0000', components: 'AB', ra: 10, dec: 20 });
    const idx = indices({
      hip2: hip2At({ hip: 42, ra: 10, dec: 20 }),
      ccdm: [{ hip: 42, ccdm: '00000+0000' }],
      hipToGaia: new Map([[42, '5000']]),
    });
    const { pairs: [r] } = resolveViaCcdm([decomposed(pair, { primary: {} })], idx);
    expect(ids(r.primary)).toMatchObject({ hip: 42, gaiaSourceId: '5000', resolveVia: 'ccdm_hip' });
  });

  it('binds no secondary of a pair whose ρ overflowed', () => {
    const pair = pairAt({ wdsId: '14396-6050', components: 'AC', ra: 219.9021, dec: -60.834, rhoLast: null, thetaLast: 225 });
    const idx = indices({
      hip2: hip2At({ hip: 71681, ra: 219.9141, dec: -60.83948 }),
      hipToManifestGaia: new Map([[71681, '999']]),
      ccdm: [{ hip: 71683, ccdm: '14396-6050' }, { hip: 71681, ccdm: '14396-6050' }],
    });
    const { pairs: [r] } = resolveViaCcdm([decomposed(pair, { secondary: {} })], idx);
    expect(ids(r.secondary)).toMatchObject({ gaiaSourceId: null, hip: null });
  });

  it('refuses a candidate a disjoint letter sits on, for both sides (Rigel)', () => {
    const ab = pairAt({ wdsId: '05145-0812', components: 'AB', ra: 100, dec: 0, rhoLast: 9.4, thetaLast: 180 });
    const bc = pairAt({ wdsId: '05145-0812', components: 'BC', ra: 100, dec: -9.4 / 3600, rhoLast: 0.1, thetaLast: 30 });
    const idx = indices({
      hip2: hip2At({ hip: 24436, ra: 100, dec: 0 }),
      ccdm: [{ hip: 24436, ccdm: '05145-0812' }],
      hipToGaia: new Map([[24436, '7777']]),
    });
    const r = resolveViaCcdm([decomposed(ab), decomposed(bc, { primary: {}, secondary: {} })], idx);
    expect(ids(r.pairs[1].primary)).toMatchObject({ hip: null, gaiaSourceId: null, resolveVia: 'unresolved' });
    expect(ids(r.pairs[1].secondary)).toMatchObject({ hip: null, gaiaSourceId: null });
    expect(r.rejected.map((x) => [x.gate, x.pair, x.component, x.hip])).toEqual([
      ['ccdm_sibling_owned', bc, 'B', 24436], ['ccdm_sibling_owned', bc, 'C', 24436],
    ]);
  });

  it('never refuses for the pair partner (σ Ori blend convention)', () => {
    const pair = pairAt({ wdsId: '00000+0000', components: 'AB', ra: 100, dec: 0, rhoLast: 2, thetaLast: 180 });
    const idx = indices({ hip2: hip2At({ hip: 99, ra: 100, dec: -1.2 / 3600 }), ccdm: [{ hip: 99, ccdm: '00000+0000' }] });
    const r = resolveViaCcdm([decomposed(pair, { secondary: {} })], idx);
    expect(r.pairs[0].secondary.hip?.value).toBe(99);
    expect(r.rejected).toHaveLength(0);
  });

  it('lets a near-tie with a non-partner letter stand', () => {
    const ab = pairAt({ wdsId: '00000+0000', components: 'AB', ra: 100, dec: 0, rhoLast: 2, thetaLast: 180 });
    const ac = pairAt({ wdsId: '00000+0000', components: 'AC', ra: 100, dec: 0, rhoLast: 2.4, thetaLast: 180 });
    const idx = indices({ hip2: hip2At({ hip: 99, ra: 100, dec: -2.2 / 3600 }), ccdm: [{ hip: 99, ccdm: '00000+0000' }] });
    const r = resolveViaCcdm([decomposed(ab), decomposed(ac, { secondary: {} })], idx);
    expect(r.pairs[1].secondary.hip?.value).toBe(99);
    expect(r.rejected).toHaveLength(0);
  });

  it('refuses a HIP another letter already binds, even at the system coordinate', () => {
    const aBc = pairAt({ wdsId: '05145-0812', components: 'A,BC', ra: 100, dec: 0, rhoLast: 9.4, thetaLast: 204 });
    const bc = pairAt({ wdsId: '05145-0812', components: 'BC', ra: 100, dec: 0, rhoLast: 0.1, thetaLast: 30 });
    const idx = indices({
      hip2: hip2At({ hip: 24436, ra: 100, dec: 0 }),
      ccdm: [{ hip: 24436, ccdm: '05145-0812' }],
      hipToGaia: new Map([[24436, '7777']]),
    });
    const r = resolveViaCcdm([decomposed(aBc, { primary: { hip: 24436 } }), decomposed(bc, { primary: {} })], idx);
    expect(ids(r.pairs[1].primary)).toMatchObject({ hip: null, gaiaSourceId: null });
    expect(r.rejected).toHaveLength(1);
  });

  it('skips a system with no CCDM candidates', () => {
    const pair = pairAt({ wdsId: 'UNKNOWN', components: 'AB', ra: 0, dec: 0 });
    const { pairs: [r] } = resolveViaCcdm([decomposed(pair, { primary: {} })], indices());
    expect(ids(r.primary)).toMatchObject({ resolveVia: 'unresolved', gaiaSourceId: null });
  });

  it('PM-propagates a high-PM sibling\'s HIP2 position before matching', () => {
    const pair = pairAt({ wdsId: '00000+0000', components: 'AB', ra: 100, dec: 0 });
    const idx = indices({
      hip2: hip2At({ hip: 42, ra: 100 + 30 / 3600, dec: 0, pmRaMasyr: -3428.6, pmDeMasyr: 0 }),
      ccdm: [{ hip: 42, ccdm: '00000+0000' }],
      hipToGaia: new Map([[42, '5000']]),
    });
    const { pairs: [r] } = resolveViaCcdm([decomposed(pair, { primary: {} })], idx);
    expect(ids(r.primary)).toMatchObject({ hip: 42, gaiaSourceId: '5000', resolveVia: 'ccdm_hip' });
  });

  it('prefers a carried HIP among the candidates over a position match', () => {
    const pair = pairAt({ wdsId: '00000+0000', components: 'AB', ra: 100, dec: 0 });
    const idx = indices({
      hip2: hip2At({ hip: 8, ra: 100, dec: 0 }, { hip: 9, ra: 100, dec: 0 }),
      hipToManifestGaia: new Map([[8, '8000'], [9, '9000']]),
      ccdm: [{ hip: 8, ccdm: '00000+0000' }, { hip: 9, ccdm: '00000+0000' }],
    });
    const { pairs: [r] } = resolveViaCcdm([decomposed(pair, { primary: { hip: 9 } })], idx);
    expect(ids(r.primary)).toMatchObject({ hip: 9, gaiaSourceId: '9000', resolveVia: 'ccdm_hip' });
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
  it('binds a primary to the manifest star at its coord', () => {
    const pair = pairAt({ components: 'Ca,Cb', ra: 217.4296, dec: -62.6795 });
    const stars = [starAt({ ra: 217.4296, dec: -62.6795, gaia: '5853498713190525696' })];
    const { pairs: [r] } = resolveViaPosition([decomposed(pair, { primary: {} })], stars);
    expect(ids(r.primary)).toMatchObject({ resolveVia: 'position_pm', gaiaSourceId: '5853498713190525696', athygRow: null });
    expect(r.primary.gaia?.origin).toEqual(OWN);
  });

  it('tags a star whose position states no proper motion position_nopm', () => {
    const pair = pairAt({ components: 'AB', ra: 100, dec: 0 });
    const { pairs: [r] } = resolveViaPosition([decomposed(pair, { primary: {} })], [starAt({ ra: 100, dec: 0, gaia: '7', hasPm: false })]);
    expect(ids(r.primary)).toMatchObject({ resolveVia: 'position_nopm', gaiaSourceId: '7' });
  });

  it('binds a secondary at its predicted position', () => {
    const pair = pairAt({ components: 'AB', ra: 100, dec: 0, rhoLast: 360, thetaLast: 0 });
    const stars = [starAt({ ra: 100, dec: 0, gaia: '111' }), starAt({ ra: 100, dec: 0.1, gaia: '222' })];
    const { pairs: [r] } = resolveViaPosition([decomposed(pair, { primary: {}, secondary: {} })], stars);
    expect(r.primary.gaia?.value).toBe('111');
    expect(ids(r.secondary)).toMatchObject({ gaiaSourceId: '222', resolveVia: 'position_pm' });
  });

  it('binds no ρ = 0 secondary to its primary\'s star: the primary\'s source would bind to it too', () => {
    const pair = pairAt({ components: 'AB', ra: 100, dec: 0, rhoLast: 0, thetaLast: 0 });
    const { pairs: [r] } = resolveViaPosition([decomposed(pair, { primary: {}, secondary: {} })], [starAt({ ra: 100, dec: 0, gaia: '111' })]);
    expect(r.primary.gaia?.value).toBe('111');
    expect([r.secondary.gaia, r.secondary.hip]).toEqual([null, null]);
  });

  it('leaves a bound component alone', () => {
    const pair = pairAt({ components: 'AB', ra: 100, dec: 0 });
    const { pairs: [r] } = resolveViaPosition(
      [decomposed(pair, { primary: { gaiaSourceId: '100', resolveVia: 'orb6_hip' } })], [starAt({ ra: 100, dec: 0, gaia: '999' })],
    );
    expect(ids(r.primary)).toMatchObject({ resolveVia: 'orb6_hip', gaiaSourceId: '100' });
  });

  it('binds only the HIP when the matched star has no Gaia source', () => {
    const pair = pairAt({ components: 'AB', ra: 100, dec: 0 });
    const { pairs: [r] } = resolveViaPosition([decomposed(pair, { primary: {} })], [starAt({ ra: 100, dec: 0, hip: 5 })]);
    expect(ids(r.primary)).toMatchObject({ resolveVia: 'unresolved', gaiaSourceId: null, hip: 5 });
  });

  it('refuses a star whose HIP a disjoint letter binds (Rigel)', () => {
    const ad = pairAt({ wdsId: '05145-0812', components: 'AD' });
    const bc = pairAt({ wdsId: '05145-0812', components: 'BC', ra: 100, dec: 0, rhoLast: 0.1, thetaLast: 30 });
    const stars = [starAt({ ra: 100, dec: 0, gaia: '555', hip: 24436 })];
    const r = resolveViaPosition([decomposed(ad, { primary: { hip: 24436 } }), decomposed(bc, { primary: {} })], stars);
    expect(ids(r.pairs[1].primary)).toMatchObject({ hip: null, gaiaSourceId: null, resolveVia: 'unresolved' });
    expect(r.rejected).toEqual([{ gate: 'position_match_sibling_claimed', pair: bc, component: 'B', hip: 24436 }]);
  });

  it('lets a letter match a star carrying its own HIP', () => {
    const pair = pairAt({ wdsId: '00000+0000', components: 'AB', ra: 100, dec: 0, rhoLast: 0.5, thetaLast: 0 });
    const r = resolveViaPosition([decomposed(pair, { primary: { hip: 42 } })], [starAt({ ra: 100, dec: 0, gaia: '555', hip: 42 })]);
    expect(ids(r.pairs[0].primary)).toMatchObject({ gaiaSourceId: '555', resolveVia: 'position_pm' });
    expect(r.rejected).toHaveLength(0);
  });

  it('predicts no secondary position when ρ overflowed', () => {
    const pair = pairAt({ wdsId: 'X', components: 'AC', ra: 100, dec: 0, rhoLast: null, thetaLast: 225 });
    const { pairs: [r] } = resolveViaPosition([decomposed(pair, { secondary: {} })], [starAt({ ra: 99.96, dec: -0.04, gaia: '777' })]);
    expect(ids(r.secondary)).toMatchObject({ resolveVia: 'unresolved', gaiaSourceId: null });
  });

  it('records the matched star\'s HIP', () => {
    const pair = pairAt({ components: 'AB', ra: 100, dec: 0 });
    const { pairs } = resolveViaPosition([decomposed(pair, { primary: {} })], [starAt({ ra: 100, dec: 0, hip: 99, gaia: '42' })]);
    expect(ids(componentsOf(pairs)[0])).toMatchObject({ gaiaSourceId: '42', hip: 99 });
  });
});
