import { describe, expect, it } from 'vitest';

import { SEEDED_BRANCH, seededCodeCheck } from '../../catalog/lineage/count-block-fixture';
import { foldStageLines, sortLineageLines, stageLineageText } from '../../catalog/lineage/lineage-row-pure';
import { MULTIPLES_TSV } from '../multiples-tsv';
import { MULTIPLES_HEADER, multiplesLine } from '../multiples-tsv-fixture';
import { BINDING_CODES, bindingLineageLines, bindingLineageRows } from './binding-lineage-pure';

const GAIA = '4000000000000000001';

const records = MULTIPLES_TSV.parse([
  MULTIPLES_HEADER,
  multiplesLine({ system_id: '00001+0001-AB', comp: 'A', gaia_source_id: GAIA, hip: '71683' }),
  multiplesLine({
    system_id: '00001+0001-AB', comp: 'B', orbit_role: 'secondary',
    gaia_source_id: GAIA, gaia_origin: 'blend:A', hip: '71683', hip_origin: 'partner:A',
  }),
  multiplesLine({ system_id: '00002+0002-AB', comp: 'Aa', hip: '12', hip_origin: 'parent:A' }),
  multiplesLine({ system_id: '00003+0003-AB', comp: 'A', gaia_source_id: GAIA, gaia_origin: 'letter:Aa' }),
].join('\n') + '\n');

describe('bindingLineageRows', () => {
  it('writes each component\'s Gaia and HIP binding under its multiples.tsv row, naming the donor token of a copy', () => {
    expect([...bindingLineageRows(records)].map((r) => [r.key, r.code, r.params])).toEqual([
      ['multiples:00001+0001-AB/A', 'binding.gaia.own', `{"gaia":"${GAIA}"}`],
      ['multiples:00001+0001-AB/A', 'binding.hip.own', '{"hip":"hip:71683"}'],
      ['multiples:00001+0001-AB/B', 'binding.gaia.inherited.blend', `{"gaia":"${GAIA}","from":"A"}`],
      ['multiples:00001+0001-AB/B', 'binding.hip.inherited.partner', '{"hip":"hip:71683","from":"A"}'],
      ['multiples:00002+0002-AB/Aa', 'binding.gaia.unbound', ''],
      ['multiples:00002+0002-AB/Aa', 'binding.hip.inherited.parent', '{"hip":"hip:12","from":"A"}'],
      ['multiples:00003+0003-AB/A', 'binding.gaia.inherited.letter', `{"gaia":"${GAIA}","from":"Aa"}`],
      ['multiples:00003+0003-AB/A', 'binding.hip.unbound', ''],
    ]);
  });

  it('writes lines the stage writer accepts, with no evidence and every row an outcome', () => {
    const rows = [...bindingLineageRows(records)];
    expect(rows.every((r) => r.role === 'outcome' && r.evidence.length === 0)).toBe(true);
    expect(() => stageLineageText(BINDING_CODES, sortLineageLines(bindingLineageLines(records)))).not.toThrow();
  });
});

describe('BINDING_CODES', () => {
  it('declares own, unbound and one inherited code per inheritance kind, for each identifier', () => {
    expect(BINDING_CODES.live).toHaveLength(12);
  });

  it('folds two rows per component, one per identifier', () => {
    const counts = foldStageLines(BINDING_CODES, bindingLineageLines(records));
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(2 * records.length);
    expect(counts['binding.gaia.own']).toBe(1);
    expect(counts['binding.hip.unbound']).toBe(1);
  });

  it('reaches the count snapshot with a newly declared code', () => {
    const { drift, refreshed } = seededCodeCheck(BINDING_CODES, bindingLineageLines(records));
    expect(drift.drifted).toBe(true);
    expect(drift.report).toContain(`binding.${SEEDED_BRANCH}`);
    expect(refreshed.drifted).toBe(false);
  });
});
