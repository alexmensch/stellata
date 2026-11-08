import { describe, expect, it } from 'vitest';

import { athygRow, wdsPair } from '../load/load-fixture';
import { inheritDownwardParentBindings, propagateBlendIdentity, propagateWithinSystem } from './propagate-pure';
import { BI_WDS, biComp, biPair, resolved } from './resolve-fixture';

describe('propagateWithinSystem', () => {
  it('carries a letter\'s binding to its other rows, and no further', () => {
    const [, acA, acC] = propagateWithinSystem([
      resolved({ wdsId: 'X', discoverer: 'DA', gaiaSourceId: '42', resolveVia: 'orb6_hip' }),
      resolved({ wdsId: 'X', discoverer: 'DA' }),
      resolved({ wdsId: 'X', discoverer: 'DA', component: 'C', isPrimary: false }),
    ]);
    expect(acA).toMatchObject({ gaiaSourceId: '42', resolveVia: 'orb6_hip' });
    expect(acC.gaiaSourceId).toBeNull();
  });

  it('does not cross systems', () => {
    const [, y] = propagateWithinSystem([
      resolved({ wdsId: 'X', discoverer: 'D', gaiaSourceId: '100', resolveVia: 'orb6_hip' }),
      resolved({ wdsId: 'Y', discoverer: 'D' }),
    ]);
    expect(y.gaiaSourceId).toBeNull();
  });

  it('carries the strongest tier, and never retags a bound row', () => {
    const [simbad, orb6, unbound] = propagateWithinSystem([
      resolved({ wdsId: 'X', discoverer: 'DA', gaiaSourceId: '42', resolveVia: 'simbad_xid' }),
      resolved({ wdsId: 'X', discoverer: 'DB', gaiaSourceId: '42', resolveVia: 'orb6_hip' }),
      resolved({ wdsId: 'X', discoverer: 'DC' }),
    ]);
    expect(unbound).toMatchObject({ gaiaSourceId: '42', resolveVia: 'orb6_hip' });
    expect(simbad.resolveVia).toBe('simbad_xid');
    expect(orb6.resolveVia).toBe('orb6_hip');
  });

  it('gives a bare letter its sub-letter\'s binding (Castor A ← Aa)', () => {
    const [, a] = propagateWithinSystem([
      resolved({ wdsId: '07346+3153', discoverer: 'CIA  29', component: 'Aa', gaiaSourceId: '1234', resolveVia: 'simbad_xid', hip: 36850 }),
      resolved({ wdsId: '07346+3153', discoverer: 'STF1110' }),
    ]);
    expect(a).toMatchObject({ gaiaSourceId: '1234', resolveVia: 'simbad_xid', hip: 36850 });
  });

  it('never gives a sub-letter its parent\'s', () => {
    const [, aa] = propagateWithinSystem([
      resolved({ wdsId: 'X', discoverer: 'DA', gaiaSourceId: '42', resolveVia: 'orb6_hip' }),
      resolved({ wdsId: 'X', discoverer: 'DB', component: 'Aa' }),
    ]);
    expect(aa.gaiaSourceId).toBeNull();
  });

  it('takes the strongest tier among the sub-letters', () => {
    const [, , bare] = propagateWithinSystem([
      resolved({ wdsId: 'X', discoverer: 'D1', component: 'Aa', gaiaSourceId: '42', resolveVia: 'simbad_xid' }),
      resolved({ wdsId: 'X', discoverer: 'D2', component: 'Ab', isPrimary: false, gaiaSourceId: '42', resolveVia: 'orb6_hip' }),
      resolved({ wdsId: 'X', discoverer: 'D3' }),
    ]);
    expect(bare).toMatchObject({ gaiaSourceId: '42', resolveVia: 'orb6_hip' });
  });

  it('carries a HIP with no source to the letter\'s other rows (Sirius A)', () => {
    const [, ac, ad] = propagateWithinSystem([
      resolved({ wdsId: 'X', discoverer: 'D', hip: 32349 }),
      resolved({ wdsId: 'X', discoverer: 'D' }),
      resolved({ wdsId: 'X', discoverer: 'D' }),
    ]);
    expect(ac.hip).toBe(32349);
    expect(ad.hip).toBe(32349);
  });
});

describe('propagateBlendIdentity', () => {
  const fixture = (rho: number | null, secondaryHip: number | null = null) => {
    const pair = wdsPair({ wdsId: 'W1', components: 'Aa,Ab', rhoLast: rho });
    const primary = resolved({
      wdsId: 'W1', component: 'Aa', gaiaSourceId: '42', resolveVia: 'orb6_hip', hip: 7, athygRow: athygRow({ gaia: '42', hip: 7 }),
    });
    const secondary = resolved({ wdsId: 'W1', component: 'Ab', isPrimary: false, hip: secondaryHip });
    return { pair, primary, secondary };
  };

  it('gives a ρ = 0 secondary its primary\'s identity', () => {
    const { pair, primary, secondary } = fixture(0);
    const r = propagateBlendIdentity([primary, secondary], [pair]);
    expect(r.seeded).toHaveLength(1);
    expect(r.components[1]).toMatchObject({ gaiaSourceId: '42', hip: 7, resolveVia: 'orb6_hip' });
    expect(r.components[1].athygRow).toBe(primary.athygRow);
  });

  it('leaves a measured pair alone', () => {
    const { pair, primary, secondary } = fixture(1.5);
    const r = propagateBlendIdentity([primary, secondary], [pair]);
    expect(r.seeded).toHaveLength(0);
    expect(r.components[1].gaiaSourceId).toBeNull();
  });

  it('leaves a secondary with any binding of its own alone', () => {
    const { pair, primary, secondary } = fixture(0, 99);
    const r = propagateBlendIdentity([primary, secondary], [pair]);
    expect(r.seeded).toHaveLength(0);
    expect(r.components[1]).toMatchObject({ gaiaSourceId: null, hip: 99 });
  });
});

describe('inheritDownwardParentBindings', () => {
  it('gives both sides of an unbound sub-pair their parent letter\'s binding', () => {
    const pairs = [biPair(BI_WDS, 'A,B', 5.0, 0.0), biPair(BI_WDS, 'Aa,Ab', 0.0, 0.0)];
    const comps = [
      biComp(BI_WDS, 'A', true, '100'), biComp(BI_WDS, 'B', false, '300'),
      biComp(BI_WDS, 'Aa', true, null), biComp(BI_WDS, 'Ab', false, null),
    ];
    const r = inheritDownwardParentBindings(pairs, comps, new Set([BI_WDS]));
    expect(r.seeded).toHaveLength(2);
    expect(r.components[2].gaiaSourceId).toBe('100');
    expect(r.components[3].gaiaSourceId).toBe('100');
  });
});
