import { describe, expect, it } from 'vitest';

import { componentKey } from '../component-tokens-pure';
import type { IdentifierIndices } from '../load/indices-pure';
import { orb6Entry, wdsPair } from '../../wds/wds-fixture';
import type { BindingVerdict } from './binding-audit-pure';
import { componentsOf, type DecomposedPair } from './components-pure';
import { astrometryRequestIds, resolveCascade, type Stage2Result } from './resolve-pairs';
import { decomposed, indices, ids, xid, type Side } from './resolve-fixture';

describe('resolveCascade', () => {
  it('emits the primary and secondary of each decomposing pair', () => {
    const pair = wdsPair({ components: 'AB' });
    const { pairs } = resolveCascade({
      pairs: [pair], orb6: [orb6Entry({ wdsId: pair.wdsId, components: 'AB', hip: 1 })],
      indices: indices({ hipToGaia: new Map([[1, '1001']]) }), athyg: [], simbadWdsXids: new Map(),
    });
    expect(pairs).toHaveLength(1);
    expect(ids(pairs[0].primary)).toMatchObject({ isPrimary: true, resolveVia: 'orb6_hip', gaiaSourceId: '1001' });
    expect(ids(pairs[0].secondary)).toMatchObject({ isPrimary: false, resolveVia: 'unresolved', gaiaSourceId: null });
  });

  it('skips a blank components row', () => {
    const { pairs } = resolveCascade({
      pairs: [wdsPair({ components: '' })], orb6: [], indices: indices(), athyg: [], simbadWdsXids: new Map(),
    });
    expect(pairs).toEqual([]);
  });

  it('binds through SIMBAD where no identifier signal reaches', () => {
    const { pairs } = resolveCascade({
      pairs: [wdsPair({ wdsId: '00491+5749', components: 'AB' })], orb6: [], indices: indices(), athyg: [],
      simbadWdsXids: new Map([[componentKey('00491+5749', 'B'), xid('00491+5749', 'B', '425040000962497792')]]),
    });
    expect(pairs[0].primary.resolveVia).toBe('unresolved');
    expect(ids(pairs[0].secondary)).toMatchObject({ resolveVia: 'simbad_xid', gaiaSourceId: '425040000962497792' });
  });
});

describe('astrometryRequestIds', () => {
  const result = (pairs: DecomposedPair[], verdicts: BindingVerdict[] = []): Stage2Result =>
    ({ pairs, siblingRejections: [], synthesizedSeeds: [], verdicts });
  const pair = (wdsId: string, primary: Side, secondary: Side) => decomposed(wdsPair({ wdsId, components: 'AB' }), { primary, secondary });
  const withRejects = (xwalk: IdentifierIndices['xwalkMagRejected'], athyg: IdentifierIndices['athygGaiaMagRejected']) =>
    ({ ...indices(), xwalkMagRejected: xwalk, athygGaiaMagRejected: athyg });

  it('is every bound source once, an unbound component adding nothing', () => {
    const pairs = [
      pair('X', { gaiaSourceId: '222', resolveVia: 'orb6_hip' }, { gaiaSourceId: '111', resolveVia: 'athyg_gaia_native' }),
      pair('Y', { gaiaSourceId: '222', resolveVia: 'athyg_gaia_native' }, {}),
    ];
    expect(componentsOf(pairs).filter((c) => c.gaia === null)).toHaveLength(1);
    expect(astrometryRequestIds(result(pairs), indices())).toEqual(new Set(['111', '222']));
  });

  it('keeps every source a gate weighed', () => {
    const verdict: BindingVerdict = {
      wdsId: 'X', shape: 'letter_sources', verdict: 'unbound_ambiguous', contested: 'A', reference: null, winner: null,
      candidates: [{ label: '555', tokens: ['A'], sourceId: '555', errArcsec: Infinity, predictedSepArcsec: 0 }],
      action: { kind: 'unbind', targets: [{ token: 'A', sourceId: '555' }] },
    };
    const ids = astrometryRequestIds(
      result([pair('X', { gaiaSourceId: '111', resolveVia: 'orb6_hip' }, {})], [verdict]),
      withRejects([{ hip: 1, sourceId: '333' }, { hip: 2, sourceId: '111' }], [{ hip: null, sourceId: '444' }]),
    );
    expect([...ids].sort()).toEqual(['111', '333', '444', '555']);
    expect(ids.size).toBe(4);
  });
});
