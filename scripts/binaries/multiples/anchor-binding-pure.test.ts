import { describe, expect, it } from 'vitest';

import { wdsPair } from '../../wds/wds-fixture';
import type { DecomposedPair } from '../resolve/components-pure';
import { decomposed } from '../resolve/resolve-fixture';
import { anchorBindings } from './anchor-binding-pure';
import { computeAnchorOffsets } from './anchor-offsets-pure';

const W = 'WDS-1';
const UNBOUND = { gaiaSourceId: null, resolveVia: 'unresolved' } as const;
const BOUND = { gaiaSourceId: '42', resolveVia: 'orb6_hip' } as const;
type Side = typeof UNBOUND | typeof BOUND;

function pair(components: string, rho: number | null, primary: Side, secondary: Side = UNBOUND): DecomposedPair {
  return decomposed(wdsPair({ wdsId: W, components, rhoLast: rho, thetaLast: rho === null ? null : 90.0 }), { primary, secondary });
}

function binding(pairs: readonly DecomposedPair[], placed: readonly DecomposedPair[] = pairs) {
  const anchors = computeAnchorOffsets(pairs, new Map(pairs.map((p) => [p, 'wds_notes_kept'])), {
    orbitsByPair: new Map(), spectByComp: new Map(), nOrbitsUnmapped: 0, pairMags: new Map(),
  });
  const b = anchorBindings(anchors, placed).get(W)!.binding;
  return 'boundPrimary' in b ? [b.kind, b.boundPrimary.primary.component] : [b.kind];
}

describe('anchorBindings', () => {
  it('is bound when the anchor is a bound primary', () => {
    expect(binding([pair('AB', 1.0, BOUND), pair('CD', 1.0, BOUND)])).toEqual(['bound']);
  });

  it('names the most canonical bound primary, re-basable when the chain reaches it', () => {
    expect(binding([pair('AB', 1.0, UNBOUND), pair('BC', 1.0, BOUND), pair('CD', 1.0, BOUND)])).toEqual(['re_basable', 'B']);
  });

  it('names it unreached when no measured edge links it to the anchor', () => {
    expect(binding([pair('AB', 1.0, UNBOUND), pair('CD', null, BOUND)])).toEqual(['promotion_anchor_unreached', 'C']);
  });

  it('splits a system with no bound primary by whether any secondary is bound', () => {
    expect(binding([pair('AB', 1.0, UNBOUND, BOUND)])).toEqual(['no_bound_primary']);
    expect(binding([pair('AB', 1.0, UNBOUND)])).toEqual(['nothing_bound']);
  });

  it('reads only the pairs Stage 6 placed, and calls a system none of whose pairs it placed unplaced', () => {
    const pairs = [pair('AB', 1.0, UNBOUND), pair('BC', 1.0, BOUND)];
    expect(binding(pairs, [pairs[0]])).toEqual(['nothing_bound']);
    expect(binding(pairs, [])).toEqual(['unplaced']);
  });
});
