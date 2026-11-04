import { describe, expect, it } from 'vitest';

import { describeCommittedRoundTrip } from '../util/tsv/committed-round-trip';
import {
  EXPECTED_A1_ROWS,
  EXPECTED_A2_ROWS,
  NAME_TO_GAIA_DR3,
  attachGaiaSourceIds,
  extractTables,
  parseAppendixRow,
} from './build-vaidman-table-pure';
import { ADOPTED_BJ_OLD, ADOPTED_EDSD_NEW, VAIDMAN_SUPERGIANTS } from './vaidman-tsv';

describe('parseAppendixRow', () => {
  it('reads the trailing eight numerics after a multi-token name', () => {
    const row = parseAppendixRow(
      '    1     HD 1070   2516.03    97.81    0.92    7.83    2641.01   174.85    15.32   2012.80',
      ADOPTED_EDSD_NEW,
    );
    expect(row).toEqual({
      name: 'HD 1070', dBjPaperPc: 2516.03, sigmaDBjPaperPc: 97.81, ruwe: 0.92, gMag: 7.83,
      dNewPc: 2641.01, sigmaDNewPc: 174.85, snrTot: 15.32, priorScalePc: 2012.8, adopted: ADOPTED_EDSD_NEW,
    });
  });

  it('absorbs Greek letters and digits into the name', () => {
    expect(parseAppendixRow('11 θ 2 Tau 45.84 0.89 4.61 3.38 46.80 3.55 13.61 300.00', ADOPTED_BJ_OLD)?.name).toBe('θ 2 Tau');
    expect(parseAppendixRow('119 ϵ CMa 131.01 0.35 0.96 8.38 131.05 0.46 283.79 300.00', ADOPTED_EDSD_NEW)?.gMag).toBe(8.38);
  });

  it('answers null for a header, a short line, a non-numeric column and a section title', () => {
    expect(parseAppendixRow('N Name dBJ σd,BJ RUWE G dnew σd SNRtot L', ADOPTED_EDSD_NEW)).toBeNull();
    expect(parseAppendixRow('1 HD 1070 2516.03', ADOPTED_EDSD_NEW)).toBeNull();
    expect(parseAppendixRow('1 HD 1070 2516.03 97.81 0.92 7.83 x 174.85 15.32 2012.80', ADOPTED_EDSD_NEW)).toBeNull();
    expect(parseAppendixRow('Table A1. Cont.', ADOPTED_EDSD_NEW)).toBeNull();
  });
});

describe('extractTables', () => {
  const FIXTURE = [
    'Appendix A',
    'Table A1. Distances and Gaia parameters for Galactic BA supergiants.',
    '  N    Name      dBJ    σd,BJ   RUWE   G    dnew    σd     SNRtot   L',
    '  1    HD 1070   2516.03 97.81  0.92   7.83 2641.01 174.85 15.32   2012.80',
    'Table A1. Cont.',
    '  2    BD+60 51  3638.11 126.18 0.83   9.01 3909.82 385.57 10.46   2500.00',
    'Table A2. Full machine-readable output of the Gaia distance pipeline.',
    '  1 φ Cas       4171.53 1012.79 0.92 4.74  5723.41 2433.01 2.63    2500.00',
    'References',
    '  999 STRAY 1.0 2.0 3.0 4.0 5.0 6.0 7.0 8.0',
  ].join('\n');

  it('tags A1 rows EDSD_new and A2 rows BJ_old, and stops at References', () => {
    const { a1, a2 } = extractTables(FIXTURE);
    expect(a1.map((r) => [r.name, r.adopted])).toEqual([['HD 1070', ADOPTED_EDSD_NEW], ['BD+60 51', ADOPTED_EDSD_NEW]]);
    expect(a2.map((r) => [r.name, r.adopted])).toEqual([['φ Cas', ADOPTED_BJ_OLD]]);
  });
});

describe('attachGaiaSourceIds', () => {
  const row = (name: string) => parseAppendixRow(`1 ${name} 1 1 1 1 1 1 1 1`, ADOPTED_EDSD_NEW)!;

  it('joins every name, or answers the ones the mapping lacks', () => {
    const mapping = new Map([['HD 1070', '1']]);
    const joined = attachGaiaSourceIds([row('HD 1070')], mapping);
    expect(joined.kind === 'resolved' && joined.rows.map((r) => r.gaiaSourceId)).toEqual(['1']);
    expect(attachGaiaSourceIds([row('HD 1070'), row('UNKNOWN')], mapping)).toEqual({ kind: 'missing', names: ['UNKNOWN'] });
  });

  it('maps exactly one source_id per paper row', () => {
    expect(NAME_TO_GAIA_DR3.size).toBe(EXPECTED_A1_ROWS + EXPECTED_A2_ROWS);
  });
});

describeCommittedRoundTrip(VAIDMAN_SUPERGIANTS);
