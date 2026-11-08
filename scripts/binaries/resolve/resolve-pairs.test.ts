import { describe, expect, it } from 'vitest';

import { componentKey } from '../component-tokens-pure';
import type { IdentifierIndices } from '../load/indices-pure';
import { orb6Entry, wdsPair } from '../load/load-fixture';
import type { BindingVerdict } from './binding-audit-pure';
import { toDecomposedPairs, type ResolvedComponent } from './components-pure';
import { astrometryRequestIds, resolveCascade, type Stage2Result } from './resolve-pairs';
import { indices, resolved, xid } from './resolve-fixture';

describe('resolveCascade', () => {
  it('emits the primary and secondary of each decomposing pair', () => {
    const pair = wdsPair({ components: 'AB' });
    const { components } = resolveCascade({
      pairs: [pair], orb6: [orb6Entry({ wdsId: pair.wdsId, components: 'AB', hip: 1 })],
      indices: indices({ hipToGaia: new Map([[1, '1001']]) }), athyg: [], simbadWdsXids: new Map(),
    });
    expect(components).toHaveLength(2);
    expect(components[0]).toMatchObject({ isPrimary: true, resolveVia: 'orb6_hip', gaiaSourceId: '1001' });
    expect(components[1]).toMatchObject({ isPrimary: false, resolveVia: 'unresolved', gaiaSourceId: null });
  });

  it('skips a blank components row', () => {
    const { components } = resolveCascade({
      pairs: [wdsPair({ components: '' })], orb6: [], indices: indices(), athyg: [], simbadWdsXids: new Map(),
    });
    expect(components).toEqual([]);
  });

  it('binds through SIMBAD where no identifier signal reaches', () => {
    const { components } = resolveCascade({
      pairs: [wdsPair({ wdsId: '00491+5749', components: 'AB' })], orb6: [], indices: indices(), athyg: [],
      simbadWdsXids: new Map([[componentKey('00491+5749', 'B'), xid('00491+5749', 'B', '425040000962497792')]]),
    });
    expect(components[0].resolveVia).toBe('unresolved');
    expect(components[1]).toMatchObject({ resolveVia: 'simbad_xid', gaiaSourceId: '425040000962497792' });
  });
});

describe('astrometryRequestIds', () => {
  const result = (comps: ResolvedComponent[], verdicts: BindingVerdict[] = []): Stage2Result => {
    const pairs = [];
    for (let i = 0; i < comps.length; i += 2) {
      pairs.push(wdsPair({ wdsId: comps[i].wdsId, components: `${comps[i].component}${comps[i + 1].component}` }));
    }
    return { pairs: toDecomposedPairs(pairs, comps), siblingRejections: [], synthesizedSeeds: [], verdicts };
  };
  const withRejects = (xwalk: IdentifierIndices['xwalkMagRejected'], athyg: IdentifierIndices['athygGaiaMagRejected']) =>
    ({ ...indices(), xwalkMagRejected: xwalk, athygGaiaMagRejected: athyg });

  it('is every bound source once, an unbound component adding nothing', () => {
    const ids = astrometryRequestIds(result([
      resolved({ wdsId: 'X', gaiaSourceId: '222', resolveVia: 'orb6_hip' }),
      resolved({ wdsId: 'X', component: 'B', isPrimary: false, gaiaSourceId: '111', resolveVia: 'athyg_gaia_native' }),
      resolved({ wdsId: 'Y', gaiaSourceId: '222', resolveVia: 'athyg_gaia_native' }),
      resolved({ wdsId: 'Y', component: 'B', isPrimary: false }),
    ]), indices());
    expect(ids).toEqual(new Set(['111', '222']));
  });

  it('keeps every source a gate weighed', () => {
    const verdict: BindingVerdict = {
      wdsId: 'X', shape: 'letter_sources', verdict: 'unbound_ambiguous', contested: 'A', reference: null, winner: null,
      candidates: [{ label: '555', tokens: ['A'], sourceId: '555', errArcsec: Infinity, predictedSepArcsec: 0 }],
      unbind: [{ token: 'A', sourceId: '555' }], rebind: null,
    };
    const ids = astrometryRequestIds(
      result([resolved({ wdsId: 'X', gaiaSourceId: '111', resolveVia: 'orb6_hip' }), resolved({ wdsId: 'X', component: 'B', isPrimary: false })], [verdict]),
      withRejects([{ hip: 1, sourceId: '333' }, { hip: 2, sourceId: '111' }], [{ hip: null, sourceId: '444' }]),
    );
    expect([...ids].sort()).toEqual(['111', '333', '444', '555']);
    expect(ids.size).toBe(4);
  });
});
