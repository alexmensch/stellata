import { describe, expect, it } from 'vitest';

import { wdsPair } from '../../wds/wds-fixture';
import { RESOLVE_VIA } from '../multiples-record-pure';
import { RESOLVE_VIA_PRIORITY, componentsOf, decompose, freezePairs, unresolvedComponent } from './components-pure';

describe('RESOLVE_VIA_PRIORITY', () => {
  it('ranks ccdm_hip after simbad_xid and before the position tiers', () => {
    expect(RESOLVE_VIA_PRIORITY.get('simbad_xid')!).toBeLessThan(RESOLVE_VIA_PRIORITY.get('ccdm_hip')!);
    expect(RESOLVE_VIA_PRIORITY.get('ccdm_hip')!).toBeLessThan(RESOLVE_VIA_PRIORITY.get('position_pm')!);
  });

  it('is the tag list\'s own order', () => {
    expect([...RESOLVE_VIA_PRIORITY]).toEqual(RESOLVE_VIA.map((tag, i) => [tag, i]));
  });
});

describe('decompose', () => {
  it('keeps only the rows that split, binding primary then secondary', () => {
    const calls: string[] = [];
    const pairs = decompose(
      [wdsPair({ wdsId: 'W1', components: 'AB' }), wdsPair({ wdsId: 'W2', components: 'ABC' }), wdsPair({ wdsId: 'W3', components: '' })],
      (pair, token, isPrimary) => {
        calls.push(`${pair.wdsId}:${token}:${isPrimary}`);
        return unresolvedComponent(pair, token, isPrimary);
      },
    );
    expect(pairs.map((p) => p.pair.wdsId)).toEqual(['W1']);
    expect(calls).toEqual(['W1:A:true', 'W1:B:false']);
    expect(componentsOf(pairs).map((c) => c.component)).toEqual(['A', 'B']);
  });

  it('keeps the tokens as the components field writes them', () => {
    const [p] = decompose([wdsPair({ wdsId: 'W1', components: 'Aa1,2' })], unresolvedComponent);
    expect(p.tokens).toEqual(['Aa1', '2']);
    expect(p.secondary.component).toBe('2');
  });
});

describe('freezePairs', () => {
  it('freezes each pair and its two components', () => {
    const [p] = freezePairs(decompose([wdsPair({ components: 'AB' })], unresolvedComponent));
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.primary)).toBe(true);
    expect(Object.isFrozen(p.secondary)).toBe(true);
  });
});
