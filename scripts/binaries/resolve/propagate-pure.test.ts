import { describe, expect, it } from 'vitest';

import { wdsPair } from '../../wds/wds-fixture';
import { athygRow } from '../load/load-fixture';
import {
  inheritDownwardParentBindings, propagateBlendIdentity, propagateWithinSystem, seedSynthesizedComponentBindings,
} from './propagate-pure';
import { BI_WDS, alone, biPair, decomposed, ids, lone, resolved } from './resolve-fixture';
import type { ResolvedComponent } from './components-pure';
import { OWN, inheritedFrom } from '../multiples-tsv';

const smear = (...cs: ResolvedComponent[]) => lone(propagateWithinSystem(cs.map(alone)));

describe('propagateWithinSystem', () => {
  it('carries a letter\'s binding to its other rows, and no further', () => {
    const [, acA, acC] = smear(
      resolved({ wdsId: 'X', discoverer: 'DA', gaiaSourceId: '42', resolveVia: 'orb6_hip' }),
      resolved({ wdsId: 'X', discoverer: 'DA' }),
      resolved({ wdsId: 'X', discoverer: 'DA', component: 'C', isPrimary: false }),
    );
    expect(ids(acA)).toMatchObject({ gaiaSourceId: '42', resolveVia: 'orb6_hip' });
    expect(acA.gaia?.origin).toEqual(OWN);
    expect(acC.gaia).toBeNull();
  });

  it('does not cross systems', () => {
    const [, y] = smear(
      resolved({ wdsId: 'X', discoverer: 'D', gaiaSourceId: '100', resolveVia: 'orb6_hip' }),
      resolved({ wdsId: 'Y', discoverer: 'D' }),
    );
    expect(y.gaia).toBeNull();
  });

  it('carries the strongest tier, and never retags a bound row', () => {
    const [simbad, orb6, unbound] = smear(
      resolved({ wdsId: 'X', discoverer: 'DA', gaiaSourceId: '42', resolveVia: 'simbad_xid' }),
      resolved({ wdsId: 'X', discoverer: 'DB', gaiaSourceId: '42', resolveVia: 'orb6_hip' }),
      resolved({ wdsId: 'X', discoverer: 'DC' }),
    );
    expect(ids(unbound)).toMatchObject({ gaiaSourceId: '42', resolveVia: 'orb6_hip' });
    expect(simbad.resolveVia).toBe('simbad_xid');
    expect(orb6.resolveVia).toBe('orb6_hip');
  });

  it('gives a bare letter its sub-letter\'s binding (Castor A ← Aa)', () => {
    const [, a] = smear(
      resolved({ wdsId: '07346+3153', discoverer: 'CIA  29', component: 'Aa', gaiaSourceId: '1234', resolveVia: 'simbad_xid', hip: 36850 }),
      resolved({ wdsId: '07346+3153', discoverer: 'STF1110' }),
    );
    expect(ids(a)).toMatchObject({ gaiaSourceId: '1234', resolveVia: 'simbad_xid', hip: 36850 });
    expect([a.gaia?.origin, a.hip?.origin]).toEqual([inheritedFrom('Aa', 'letter'), inheritedFrom('Aa', 'letter')]);
  });

  it('carries an inherited binding to the letter\'s other rows as inherited from its donor', () => {
    const [, , ac] = smear(
      resolved({ wdsId: 'X', discoverer: 'D1', component: 'Aa', gaiaSourceId: '42', resolveVia: 'simbad_xid' }),
      resolved({ wdsId: 'X', discoverer: 'D2', hip: 7 }),
      resolved({ wdsId: 'X', discoverer: 'D3' }),
    );
    expect([ac.gaia?.origin, ac.hip?.origin]).toEqual([inheritedFrom('Aa', 'letter'), OWN]);
  });

  it('never gives a sub-letter its parent\'s', () => {
    const [, aa] = smear(
      resolved({ wdsId: 'X', discoverer: 'DA', gaiaSourceId: '42', resolveVia: 'orb6_hip' }),
      resolved({ wdsId: 'X', discoverer: 'DB', component: 'Aa' }),
    );
    expect(aa.gaia).toBeNull();
  });

  it('takes the strongest tier among the sub-letters', () => {
    const [, , bare] = smear(
      resolved({ wdsId: 'X', discoverer: 'D1', component: 'Aa', gaiaSourceId: '42', resolveVia: 'simbad_xid' }),
      resolved({ wdsId: 'X', discoverer: 'D2', component: 'Ab', isPrimary: false, gaiaSourceId: '42', resolveVia: 'orb6_hip' }),
      resolved({ wdsId: 'X', discoverer: 'D3' }),
    );
    expect(ids(bare)).toMatchObject({ gaiaSourceId: '42', resolveVia: 'orb6_hip' });
  });

  it('carries a HIP with no source to the letter\'s other rows (Sirius A)', () => {
    const [, ac, ad] = smear(
      resolved({ wdsId: 'X', discoverer: 'D', hip: 32349 }),
      resolved({ wdsId: 'X', discoverer: 'D' }),
      resolved({ wdsId: 'X', discoverer: 'D' }),
    );
    expect(ac.hip?.value).toBe(32349);
    expect(ad.hip?.value).toBe(32349);
  });
});

describe('propagateBlendIdentity', () => {
  const row = athygRow({ gaia: '42', hip: 7 });
  const run = (rho: number | null, secondaryHip: number | null = null) => propagateBlendIdentity([decomposed(
    wdsPair({ wdsId: 'W1', components: 'Aa,Ab', rhoLast: rho }),
    { primary: { gaiaSourceId: '42', resolveVia: 'orb6_hip', hip: 7, athygRow: row }, secondary: { hip: secondaryHip } },
  )]);

  it('gives a ρ = 0 secondary its primary\'s identity', () => {
    const r = run(0);
    expect(r.seeded).toHaveLength(1);
    expect(ids(r.pairs[0].secondary)).toMatchObject({ gaiaSourceId: '42', hip: 7, resolveVia: 'orb6_hip' });
    expect(r.pairs[0].secondary.athyg?.value).toBe(row);
    const { gaia, hip, athyg } = r.pairs[0].secondary;
    expect([gaia?.origin, hip?.origin, athyg?.origin]).toEqual(Array(3).fill(inheritedFrom('Aa', 'blend')));
  });

  it('leaves a measured pair alone', () => {
    const r = run(1.5);
    expect(r.seeded).toHaveLength(0);
    expect(r.pairs[0].secondary.gaia).toBeNull();
  });

  it('leaves a secondary with any binding of its own alone', () => {
    const r = run(0, 99);
    expect(r.seeded).toHaveLength(0);
    expect(ids(r.pairs[0].secondary)).toMatchObject({ gaiaSourceId: null, hip: 99 });
  });
});

describe('seedSynthesizedComponentBindings', () => {
  const synth = (discoverer: string, components: string) =>
    wdsPair({ wdsId: 'W1', discoverer, components, dateLast: null, rhoLast: 0, thetaLast: 0, magPri: null, magSec: null, precise: null });

  it('gives a synthesized primary its parent token\'s binding, and the secondary the primary\'s (Castor C)', () => {
    const row = athygRow({ gaia: '777' });
    const parent = decomposed(wdsPair({ wdsId: 'W1', components: 'A,C' }), {
      primary: {}, secondary: { gaiaSourceId: '777', resolveVia: 'simbad_xid', hip: 101, athygRow: row },
    });
    const yyGem = synth('YY Gem', 'Ca,Cb');
    const r = seedSynthesizedComponentBindings([parent, decomposed(yyGem, { primary: {}, secondary: {} })], [yyGem]);
    expect(r.seeded).toHaveLength(2);
    for (const child of [r.pairs[1].primary, r.pairs[1].secondary]) {
      expect(ids(child)).toMatchObject({ gaiaSourceId: '777', resolveVia: 'simbad_xid', hip: 101 });
      expect(child.athyg?.value).toBe(row);
    }
    expect(r.pairs[1].primary.gaia?.origin).toEqual(inheritedFrom('C', 'parent'));
    expect(r.pairs[1].secondary.gaia?.origin).toEqual(inheritedFrom('Ca', 'partner'));
  });

  it('lets a primary\'s own binding stand, and seeds the secondary from it', () => {
    const parent = decomposed(wdsPair({ wdsId: 'W1', components: 'AB' }), { primary: { gaiaSourceId: '777', resolveVia: 'orb6_hip' } });
    const inner = synth('TST   1', 'Aa,Ab');
    const r = seedSynthesizedComponentBindings(
      [parent, decomposed(inner, { primary: { gaiaSourceId: '555', resolveVia: 'orb6_hip' }, secondary: {} })], [inner],
    );
    expect(r.pairs[1].primary.gaia?.value).toBe('555');
    expect(r.pairs[1].secondary.gaia?.value).toBe('555');
  });

  it('touches nothing without synthesized pairs', () => {
    const pair = decomposed(wdsPair({ wdsId: 'W1', components: 'AB' }), { primary: { gaiaSourceId: '1', resolveVia: 'orb6_hip' }, secondary: {} });
    const r = seedSynthesizedComponentBindings([pair], []);
    expect(r.seeded).toHaveLength(0);
    expect(r.pairs[0].secondary.gaia).toBeNull();
  });
});

describe('inheritDownwardParentBindings', () => {
  it('gives both sides of an unbound sub-pair their parent letter\'s binding', () => {
    const pairs = [
      decomposed(biPair(BI_WDS, 'A,B', 5.0, 0.0), { primary: { gaiaSourceId: '100', resolveVia: 'simbad_xid' }, secondary: { gaiaSourceId: '300', resolveVia: 'simbad_xid' } }),
      decomposed(biPair(BI_WDS, 'Aa,Ab', 0.0, 0.0), { primary: {}, secondary: {} }),
    ];
    const r = inheritDownwardParentBindings(pairs, new Set([BI_WDS]));
    expect(r.seeded).toHaveLength(2);
    expect(r.pairs[1].primary.gaia?.value).toBe('100');
    expect(r.pairs[1].secondary.gaia?.value).toBe('100');
    expect(r.pairs[1].secondary.gaia?.origin).toEqual(inheritedFrom('A', 'parent'));
  });
});
