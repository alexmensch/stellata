import { describe, expect, it } from 'vitest';

import { invariantViolations } from '../../catalog/lineage/lineage-invariant-pure';
import { sortLineageLines, stageLineageText } from '../../catalog/lineage/lineage-row-pure';
import { spectralMass } from '../masses/mass-estimate-pure';
import type { MultiplesRecord } from '../multiples-record-pure';
import { sourced } from '../resolve/resolve-fixture';
import { MASSES_CODES, MASSES_INVARIANTS, massesLineageLines, massesLineageRows } from './masses-lineage-pure';
import type { MassRead } from './multiples-rows-pure';
import { runStage6 } from './stage6-fixture';

function reads(primarySpect: string, primary: MassRead | null, secondarySpect: string, secondary: MassRead | null) {
  const [p, s] = runStage6([{ primary: sourced('1'), secondary: sourced(null) }]).rows;
  return new Map<MultiplesRecord, MassRead | null>([[{ ...p, spect: primarySpect }, primary], [{ ...s, spect: secondarySpect }, secondary]]);
}

describe('massesLineageRows', () => {
  it('writes each row\'s mass branch and what it fed, or that none was read, keyed on the row', () => {
    const rows = [...massesLineageRows(reads('G2V', { mass: spectralMass('G2V'), uses: ['q', 'a'] }, '', null))];
    expect(rows.map((r) => [r.key, r.code, r.params])).toEqual([
      ['multiples:WDS-1-AB/A', 'masses.read.main-sequence', '{"gaia":"1","spect":"G2V","for":"q,a"}'],
      ['multiples:WDS-1-AB/B', 'masses.not-read', ''],
    ]);
  });

  it('writes lines the stage writer accepts', () => {
    const lines = massesLineageLines(reads('', { mass: spectralMass(''), uses: ['q'] }, 'L4', { mass: spectralMass('L4'), uses: ['q'] }));
    expect(() => stageLineageText(MASSES_CODES, sortLineageLines(lines))).not.toThrow();
  });
});

describe('MASSES_INVARIANTS', () => {
  it('fails a spectral type the parser cannot read, unless its row is named', () => {
    const lines = sortLineageLines(massesLineageLines(reads('G2V', null, 'L4', { mass: spectralMass('L4'), uses: ['q'] })));
    const [held] = invariantViolations(MASSES_INVARIANTS, lines);
    expect([held.invariant.code, held.rows.map((r) => r.key)]).toEqual(['masses.read.unparsed', ['multiples:WDS-1-AB/B']]);
  });
});
