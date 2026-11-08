import { describe, expect, it } from 'vitest';

import { wdsPair } from '../load/load-fixture';
import { RESOLVE_VIA } from '../multiples-tsv';
import { RESOLVE_VIA_PRIORITY, decomposingPairs, toDecomposedPairs } from './components-pure';
import { resolved } from './resolve-fixture';

describe('RESOLVE_VIA_PRIORITY', () => {
  it('ranks ccdm_hip after simbad_xid and before the position tiers', () => {
    expect(RESOLVE_VIA_PRIORITY.get('simbad_xid')!).toBeLessThan(RESOLVE_VIA_PRIORITY.get('ccdm_hip')!);
    expect(RESOLVE_VIA_PRIORITY.get('ccdm_hip')!).toBeLessThan(RESOLVE_VIA_PRIORITY.get('position_pm')!);
  });

  it('is the tag list\'s own order', () => {
    expect([...RESOLVE_VIA_PRIORITY]).toEqual(RESOLVE_VIA.map((tag, i) => [tag, i]));
  });
});

describe('decomposingPairs', () => {
  it('walks the decomposing pairs, skipping a row with no confident split', () => {
    const pairs = [wdsPair({ wdsId: 'W1', components: 'AB' }), wdsPair({ wdsId: 'W2', components: 'ABC' })];
    const comps = [
      resolved({ wdsId: 'W1', gaiaSourceId: '1' }),
      resolved({ wdsId: 'W1', component: 'B', isPrimary: false, gaiaSourceId: '2' }),
    ];
    expect([...decomposingPairs(pairs, comps)].map((w) => [comps[w.primary].component, comps[w.secondary].component]))
      .toEqual([['A', 'B']]);
  });

  it('throws when the components fall out of step with the pairs', () => {
    const comps = [resolved({ wdsId: 'W2' }), resolved({ wdsId: 'W2', component: 'B', isPrimary: false })];
    expect(() => [...decomposingPairs([wdsPair({ wdsId: 'W1', components: 'AB' })], comps)]).toThrow(/out of step/);
  });
});

describe('toDecomposedPairs', () => {
  it('pairs each row with its two frozen components, tokens as written', () => {
    const pair = wdsPair({ wdsId: 'W1', components: 'Aa1,2' });
    const [d] = toDecomposedPairs([pair], [
      resolved({ wdsId: 'W1', component: 'Aa1' }), resolved({ wdsId: 'W1', component: '2', isPrimary: false }),
    ]);
    expect(d.pair).toBe(pair);
    expect(d.tokens).toEqual(['Aa1', '2']);
    expect(Object.isFrozen(d.primary)).toBe(true);
  });

  it('throws on components left over after the last pair', () => {
    expect(() => toDecomposedPairs([], [resolved(), resolved({ isPrimary: false })])).toThrow(/2 components for 0/);
  });
});
