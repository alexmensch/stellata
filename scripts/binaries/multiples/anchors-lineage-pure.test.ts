import { describe, expect, it } from 'vitest';

import { invariantViolations } from '../../catalog/lineage/lineage-invariant-pure';
import { sortLineageLines, stageLineageText } from '../../catalog/lineage/lineage-row-pure';
import { wdsPair } from '../../wds/wds-fixture';
import type { DecomposedPair } from '../resolve/components-pure';
import { decomposed } from '../resolve/resolve-fixture';
import { anchorBindings } from './anchor-binding-pure';
import { computeAnchorOffsets } from './anchor-offsets-pure';
import { ANCHORS_CODES, ANCHORS_INVARIANTS, anchorsLineageLines, anchorsLineageRows } from './anchors-lineage-pure';

const UNBOUND = { gaiaSourceId: null, resolveVia: 'unresolved' } as const;
const BOUND = { gaiaSourceId: '42', resolveVia: 'orb6_hip' } as const;

function pair(wdsId: string, components: string, rho: number | null, primary: typeof UNBOUND | typeof BOUND): DecomposedPair {
  return decomposed(wdsPair({ wdsId, components, rhoLast: rho, thetaLast: rho === null ? null : 90.0 }), { primary, secondary: UNBOUND });
}

function anchors(pairs: readonly DecomposedPair[]) {
  const offsets = computeAnchorOffsets(pairs, new Map(pairs.map((p) => [p, 'wds_notes_kept'])), {
    orbitsByPair: new Map(), spectByComp: new Map(), nOrbitsUnmapped: 0, pairMags: new Map(),
  });
  return anchorBindings(offsets, pairs);
}

describe('anchorsLineageRows', () => {
  it('writes the anchor and its reason, each candidate it outranked with the step, then its binding, under the anchor\'s row', () => {
    const rows = [...anchorsLineageRows(anchors([pair('W', 'Aa,Ab', 1.0, UNBOUND), pair('W', 'BC', 1.0, BOUND), pair('W', 'A,D', 1.0, UNBOUND), pair('W', 'AB', 1.0, UNBOUND)]))];
    expect(rows.map((r) => [r.key, r.role, r.code, r.params, r.evidence.join('|')])).toEqual([
      ['multiples:W-A,D/A', 'outcome', 'anchors.chosen.length', '{"anchor":"A"}', ''],
      ['multiples:W-A,D/A', 'refused', 'anchors.ranked-out.length', '{"candidate":"Aa"}', 'multiples:W-Aa,Ab/Aa'],
      ['multiples:W-A,D/A', 'refused', 'anchors.ranked-out.letter', '{"candidate":"B","gaia":"42"}', 'multiples:W-BC/B'],
      ['multiples:W-A,D/A', 'outcome', 'anchors.binding.re-basable', '{"bound_primary":"B","gaia":"42"}', 'multiples:W-BC/B'],
    ]);
  });

  it('writes a sole anchor once, with a binding that names no other primary', () => {
    expect([...anchorsLineageRows(anchors([pair('W', 'AB', 1.0, BOUND)]))].map((r) => r.code)).toEqual([
      'anchors.chosen.sole', 'anchors.binding.bound',
    ]);
  });

  it('writes lines the stage writer accepts', () => {
    const lines = anchorsLineageLines(anchors([pair('W', 'AB', 1.0, UNBOUND), pair('V', 'AB', 1.0, BOUND), pair('V', 'CD', null, BOUND)]));
    expect(() => stageLineageText(ANCHORS_CODES, sortLineageLines(lines))).not.toThrow();
  });
});

describe('ANCHORS_INVARIANTS', () => {
  it('fails a system whose promotion anchor its chain never reaches, unless named', () => {
    const lines = sortLineageLines(anchorsLineageLines(anchors([pair('W', 'AB', 1.0, UNBOUND), pair('W', 'CD', null, BOUND)])));
    const [held] = invariantViolations(ANCHORS_INVARIANTS, lines);
    expect([held.invariant.code, held.rows.map((r) => r.key)]).toEqual(['anchors.binding.promotion-anchor-unreached', ['multiples:W-AB/A']]);
  });
});
