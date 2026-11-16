import { describe, expect, it } from 'vitest';

import { invariantViolations } from '../../catalog/lineage/lineage-invariant-pure';
import { sortLineageLines, stageLineageText } from '../../catalog/lineage/lineage-row-pure';
import { auditBindingIntegrity, bindingIntegrityCounts, enforceBindingVerdicts, verdictTouches } from './binding-audit-pure';
import type { CascadeRefusal } from './cascade-pure';
import { BI_WDS, astrometryMap, biAstro, biSystem, indices, type BiRow } from './resolve-fixture';
import {
  RESOLVE_CODES, RESOLVE_INVARIANTS, resolveCounts, resolveLineageLines, resolveLineageRows,
} from './resolve-lineage-pure';

const SA = '100';
const SX = '200';
const SC = '300';

function stage2(rows: readonly BiRow[], astro: ReturnType<typeof biAstro>[], refusals: CascadeRefusal[] = []) {
  const idx = indices({ srcToAstrometry: astrometryMap(astro) });
  const audit = auditBindingIntegrity(biSystem(rows), idx, new Map());
  return { pairs: enforceBindingVerdicts(audit, idx), refusals, touches: verdictTouches(audit), verdicts: audit.verdicts };
}

const geometric = (refusals: CascadeRefusal[] = []) => stage2(
  [['AB', 3.0, 0.0, [SA, null], [SX, null]], ['AC', 10.0, 0.0, [SA, null], [SX, null]]],
  [biAstro(SA, 0, 0), biAstro(SX, 0, 3)], refusals,
);

const castor = () => stage2(
  [['AB', 5.0, 0.0, [SX, null], [SX, null]], ['AC', 10.0, 0.0, [SX, null], [SC, null]]],
  [biAstro(SX, 0, -6.5), biAstro(SC, 0, 0)],
);

describe('resolveLineageRows', () => {
  it('writes each component\'s tier, each gate refusal and its part in each verdict under its multiples.tsv row', () => {
    const ac = biSystem([['AC', 10.0, 0.0, [SA, null], [SX, null]]])[0].pair;
    const r = geometric([{ gate: 'ccdm_sibling_owned', pair: ac, component: 'C', hip: 7 }]);
    const verdict = `"wds":"${BI_WDS}","contested":"${SX}:B/C","gaia":"${SX}","reference":"A","reference_gaia":"${SA}","winner":"B"`;
    expect([...resolveLineageRows(r)].map((row) => [row.key, row.role, row.code, row.params])).toEqual([
      [`multiples:${BI_WDS}-AB/A`, 'outcome', 'resolve.tier.simbad-xid', `{"gaia":"${SA}"}`],
      [`multiples:${BI_WDS}-AB/B`, 'outcome', 'resolve.tier.simbad-xid', `{"gaia":"${SX}"}`],
      [`multiples:${BI_WDS}-AC/A`, 'outcome', 'resolve.tier.simbad-xid', `{"gaia":"${SA}"}`],
      [`multiples:${BI_WDS}-AC/C`, 'outcome', 'resolve.tier.unresolved', ''],
      [`multiples:${BI_WDS}-AC/C`, 'refused', 'resolve.refused.ccdm-sibling-owned', '{"hip":"hip:7"}'],
      [`multiples:${BI_WDS}-AB/B`, 'outcome', 'resolve.audit.source-letters.geometric.won', `{${verdict}}`],
      [`multiples:${BI_WDS}-AC/C`, 'refused', 'resolve.audit.source-letters.geometric.refused', `{${verdict}}`],
    ]);
  });

  it('writes lines the stage writer accepts', () => {
    expect(() => stageLineageText(RESOLVE_CODES, sortLineageLines(resolveLineageLines(castor())))).not.toThrow();
  });
});

describe('resolveCounts', () => {
  it('counts each verdict once however many components it weighed, and each CCDM sibling refusal', () => {
    const ab = biSystem([['AB', 3.0, 0.0, [SA, null], [SX, null]]])[0].pair;
    const r = geometric([
      { gate: 'ccdm_sibling_owned', pair: ab, component: 'B', hip: 7 },
      { gate: 'orb6_hip_off_coord', pair: ab, component: 'A', hip: 8 },
    ]);
    const c = castor();
    expect(c.touches).toHaveLength(3);
    expect(resolveCounts([...resolveLineageLines(r), ...resolveLineageLines(c)])).toEqual({
      ccdm_sibling_owned_rejected: 1,
      ...bindingIntegrityCounts([...r.verdicts, ...c.verdicts]),
    });
  });
});

describe('RESOLVE_INVARIANTS', () => {
  it('fails an ambiguous unbinding it does not name, and names every listed row no line carries', () => {
    const ambiguous = stage2(
      [['AB', 3.0, 0.0, [SA, null], [SX, null]], ['AC', 5.0, 0.0, [SA, null], [SX, null]]],
      [biAstro(SA, 0, 0), biAstro(SX, 0, 4)],
    );
    const [letters, sources] = invariantViolations(RESOLVE_INVARIANTS, sortLineageLines(resolveLineageLines(ambiguous)));
    expect(sources.rows.map((row) => row.key)).toEqual([`multiples:${BI_WDS}-AB/B`, `multiples:${BI_WDS}-AC/C`]);
    expect(letters.stale).toHaveLength(23);
    expect(sources.stale).toHaveLength(8);
  });
});
