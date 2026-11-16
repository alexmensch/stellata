import { describe, expect, it } from 'vitest';

import { HIP2 } from '../../catalog/sources/hip2-source';
import { ATHYG_CLASSIC_IDS } from '../../catalog/spine/athyg-classic-ids-source';
import { invariantViolations } from '../../catalog/lineage/lineage-invariant-pure';
import { sortLineageLines, stageLineageText } from '../../catalog/lineage/lineage-row-pure';
import { sourceRowRef } from '../../util/sources/row-ref-pure';
import { wdsPair } from '../../wds/wds-fixture';
import { athygRow } from '../load/load-fixture';
import type { DecomposedPair } from '../resolve/components-pure';
import { decomposed, type Side } from '../resolve/resolve-fixture';
import {
  ASTROMETRY_CODES, ASTROMETRY_INVARIANTS, astrometryCounts, astrometryLineageLines, astrometryLineageRows,
} from './astrometry-lineage-pure';
import { measured } from './astrometry-fixture';
import { UNRESOLVED_ASTROMETRY, type ComponentAstrometry, type PairAstrometry } from './routes-pure';

const W = '12345+6789';

function stage3(rows: readonly (readonly [string, Side, ComponentAstrometry, Side, ComponentAstrometry])[], claimedHip?: number, wdsId = W) {
  const pairs: DecomposedPair[] = [];
  const astrometry = new Map<DecomposedPair, PairAstrometry>();
  for (const [components, primary, a, secondary, b] of rows) {
    const p = decomposed(wdsPair({ wdsId, components }), { primary, secondary });
    pairs.push(p);
    astrometry.set(p, { primary: a, secondary: b });
  }
  const siblingClaimed = claimedHip === undefined ? [] : [{ component: pairs[0].secondary, hip: claimedHip }];
  return { pairs, astrometry, siblingClaimed };
}

const hip2 = measured({ astrometryVia: 'hip2_long_baseline', from: sourceRowRef(HIP2, 32349) });

describe('astrometryLineageRows', () => {
  it('writes each component\'s route under its multiples.tsv row, citing the row it read', () => {
    const r = stage3([['AB', { gaiaSourceId: '42' }, measured(), { hip: 32349 }, hip2]]);
    expect([...astrometryLineageRows(r)].map((row) => [row.key, row.code, row.params, row.evidence.join('|')])).toEqual([
      [`multiples:${W}-AB/A`, 'astrometry.route.gaia-5p', '{"gaia":"42"}', 'gaia-dr3-astrometry:1'],
      [`multiples:${W}-AB/B`, 'astrometry.route.hip2-long-baseline', '{"hip":"hip:32349"}', 'i311:32349'],
    ]);
  });

  it('splits unresolved by whether the component binds anything, and names the AT-HYG row it binds', () => {
    const row = athygRow({ ref: sourceRowRef(ATHYG_CLASSIC_IDS, 7) });
    const r = stage3([['AB', {}, UNRESOLVED_ASTROMETRY, { athygRow: row }, UNRESOLVED_ASTROMETRY]], 5);
    expect([...astrometryLineageRows(r)].map((x) => [x.key, x.role, x.code, x.params])).toEqual([
      [`multiples:${W}-AB/A`, 'outcome', 'astrometry.route.unresolved.nothing-bound', ''],
      [`multiples:${W}-AB/B`, 'outcome', 'astrometry.route.unresolved.identifier-bound', '{"athyg":"athyg:7"}'],
      [`multiples:${W}-AB/B`, 'refused', 'astrometry.refused.athyg-match-sibling-claimed', '{"hip":"hip:5"}'],
    ]);
  });

  it('writes lines the stage writer accepts', () => {
    const r = stage3([['AB', { gaiaSourceId: '42' }, measured(), {}, UNRESOLVED_ASTROMETRY]], 5);
    expect(() => stageLineageText(ASTROMETRY_CODES, sortLineageLines(astrometryLineageLines(r)))).not.toThrow();
  });
});

describe('astrometryCounts', () => {
  it('counts each route, both unresolved codes as one', () => {
    const r = stage3([
      ['AB', { gaiaSourceId: '42' }, measured(), {}, UNRESOLVED_ASTROMETRY],
      ['AC', { gaiaSourceId: '42' }, measured(), { hip: 9 }, UNRESOLVED_ASTROMETRY],
    ], 5);
    expect(astrometryCounts(astrometryLineageLines(r))).toEqual({
      astrometry_gaia_nss_systemic: 0, astrometry_hip2_long_baseline: 0, astrometry_gaia_5p: 2,
      astrometry_athyg_position: 0, astrometry_unresolved: 2,
    });
  });
});

describe('ASTROMETRY_INVARIANTS', () => {
  it('fails a component that binds an identifier yet gets no astrometry, unless named', () => {
    const r = stage3([['AB', { hip: 31157 }, UNRESOLVED_ASTROMETRY, { hip: 9 }, UNRESOLVED_ASTROMETRY]], undefined, '06323+5225');
    const [held] = invariantViolations(ASTROMETRY_INVARIANTS, sortLineageLines(astrometryLineageLines(r)));
    expect(held.rows.map((row) => row.key)).toEqual(['multiples:06323+5225-AB/B']);
    expect(held.stale).toHaveLength(11);
  });
});
