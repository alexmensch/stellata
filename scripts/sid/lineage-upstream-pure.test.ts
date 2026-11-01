import { describe, expect, it } from 'vitest';

import type { IdentityRow } from '../catalog/lineage/identity-pure';
import { stageLineageLine, type LineageLine, type LineageRow } from '../catalog/lineage/lineage-row-pure';
import { LIVE, codeEffects, stageCodes } from '../catalog/lineage/reason-codes-pure';
import { lineageAdmissions, lineageCauses } from './lineage-upstream-pure';

const FIRST = stageCodes('first', {
  admitted: { description: 'Admitted.', effect: 'none', status: LIVE },
  parked: { description: 'Parked.', effect: 'park', status: LIVE },
  folded: { description: 'Folded.', effect: 'merge', status: LIVE },
});
const SECOND = stageCodes('second', {
  dropped: { description: 'Dropped.', effect: 'retire', status: LIVE },
  adopted: { description: 'Adopted.', effect: 'merge', status: LIVE },
});
const effects = codeEffects([FIRST, SECOND]);
const ORDER = ['first', 'second'];

const identityRow = (key: string, designations: string[]): IdentityRow => (
  { key, tyc: '', hip: '', hd: '', gl: '', gaia_source_id: '', designations }
);

function line(
  stage: 'first' | 'second', key: string, branch: string,
  extra: Partial<Pick<LineageRow, 'role' | 'params' | 'evidence'>> = {},
): LineageLine {
  const codes = stage === 'first' ? FIRST : SECOND;
  return stageLineageLine(codes, {
    stage, key, role: 'outcome', code: `${stage}.${branch}`, params: '', evidence: [], ...extra,
  });
}

describe('lineageCauses', () => {
  it('joins a key through every identity row carrying it to that origin\'s removal outcomes, in stage order', () => {
    const causes = lineageCauses(
      ['gaia_dr3:1', 'hip:2'],
      [
        { stage: 'first', rows: [identityRow('a', ['gaia_dr3:1']), identityRow('b', ['hip:9', 'gaia_dr3:1'])] },
        { stage: 'second', rows: [identityRow('c', ['gaia_dr3:1'])] },
      ],
      [line('second', 'c', 'dropped'), line('first', 'a', 'admitted'), line('first', 'b', 'parked')],
      effects, ORDER,
    );
    expect(causes.get('gaia_dr3:1')).toEqual({
      decisions: [
        { stage: 'first', origin: 'b', code: 'first.parked', effect: 'park', into: null },
        { stage: 'second', origin: 'c', code: 'second.dropped', effect: 'retire', into: null },
      ],
      seenBy: ['first', 'second'],
    });
    expect(causes.get('hip:2')).toEqual({ decisions: [], seenBy: [] });
  });

  it('ignores refused alternatives and rows under other origins', () => {
    const causes = lineageCauses(
      ['gaia_dr3:1'],
      [{ stage: 'first', rows: [identityRow('a', ['gaia_dr3:1'])] }],
      [line('first', 'a', 'parked', { role: 'refused' }), line('first', 'z', 'parked')],
      effects, ORDER,
    );
    expect(causes.get('gaia_dr3:1')).toEqual({ decisions: [], seenBy: ['first'] });
  });

  it('a merge points at params.record, else its single evidence ref', () => {
    const causes = lineageCauses(
      ['hip:1', 'hip:2'],
      [{ stage: 'first', rows: [identityRow('a', ['hip:1']), identityRow('b', ['hip:2'])] }],
      [
        line('first', 'a', 'folded', { evidence: ['spine:9'] }),
        line('second', 'b', 'adopted', { params: '{"record":"spine:8"}', evidence: ['spine:7', 'spine:6'] }),
      ],
      effects, ORDER,
    );
    expect(causes.get('hip:1')!.decisions[0].into).toBe('spine:9');
    expect(causes.get('hip:2')!.decisions[0].into).toBe('spine:8');
  });
});

describe('lineageAdmissions', () => {
  it('takes each wanted origin\'s admitting outcome', () => {
    const admissions = lineageAdmissions(
      ['a', 'b'],
      [line('first', 'a', 'admitted'), line('first', 'b', 'parked'), line('first', 'c', 'admitted')],
      (code) => code === 'first.admitted',
    );
    expect([...admissions]).toEqual([['a', 'first.admitted']]);
  });
});
