import { describe, expect, it } from 'vitest';

import type { GaiaAstrometryCatalogRow } from '../../catalog/sources/gaia-astrometry-source';
import {
  GAIA_NATIVE_BINDING, GATE_REPRODUCED_BINDING, gaiaCompleteSourceIds, glSuffix, keyedRows, membershipKeys, requestLines, valueCohort,
} from './membership-keys-pure';
import { WIDENING_LADDER } from './simbad-specs-pure';
import { record } from './simbad-test-fixtures';

describe('membershipKeys', () => {
  it('keys a Gaia row on its source_id and partitions the rest by the widening ladder', () => {
    const keys = membershipKeys([
      record({ gaiaSourceId: '12345', hip: 1, tyc: '1-2-1' }),
      record({ hip: 777, tyc: '3-4-1' }),
      record({ tyc: '5-6-1', gl: 'GJ 3207' }),
      record({ gl: 'Gl 165A' }),
      record({ proper: 'Sol' }),
    ]);
    expect(keys.sourceIds).toEqual(['12345']);
    expect(keys.byNamespace).toEqual({ hip: ['777'], tyc: ['5-6-1'], gj: ['165A'] });
    expect(keys.keyless).toBe(1);
    expect(keyedRows(keys) + keys.keyless).toBe(5);
  });

  it('collects designations for the source_id-keyed rows alone, in the same pass', () => {
    const keys = membershipKeys([
      record({ gaiaSourceId: '1', hip: 5, tyc: '1-2-1', gl: 'GJ 9' }),
      record({ gaiaSourceId: '2' }),
      record({ tyc: '9-9-1' }),
    ]);
    expect(keys.designations).toEqual(new Map([['1', { hip: '5', tyc: '1-2-1', gj: '9' }]]));
    expect(keys.byNamespace.tyc).toEqual(['9-9-1']);
  });

  it('reads a designation for every rung of the ladder, so no rung finds no candidates', () => {
    const keys = membershipKeys([record({ gaiaSourceId: '1', hip: 5, tyc: '1-2-1', gl: 'GJ 9' })]);
    const rungs = WIDENING_LADDER.map((ns) => ns.name).sort();
    expect(Object.keys(keys.designations.get('1') ?? {}).sort()).toEqual(rungs);
    expect(Object.keys(keys.byNamespace).sort()).toEqual(rungs);
  });

  it('narrows the partition and the designations alike to the rows the filter keeps', () => {
    const keys = membershipKeys([
      record({ gaiaSourceId: '1', binding: GATE_REPRODUCED_BINDING, tyc: '1-2-1' }),
      record({ gaiaSourceId: '2', binding: 'simbad_corroborated', tyc: '3-4-1' }),
    ], valueCohort(new Set(['1', '2'])));
    expect(keys.sourceIds).toEqual(['2']);
    expect(keys.designations).toEqual(new Map([['2', { tyc: '3-4-1' }]]));
  });
});

describe('requestLines', () => {
  it('names every key a row is asked under, source_id rows first', () => {
    expect(requestLines(membershipKeys([
      record({ gaiaSourceId: '1', hip: 5, tyc: '1-2-1', gl: 'GJ 9', proper: 'A' }),
      record({ gaiaSourceId: '2', proper: 'B' }),
      record({ tyc: '9-9-1' }),
      record({ hip: 7 }),
    ]))).toEqual(['source_id:1 gj:9 hip:5 tyc:1-2-1', 'source_id:2', 'hip:7', 'tyc:9-9-1']);
  });

  it('ignores a column no key reads', () => {
    expect(requestLines(membershipKeys([record({ gaiaSourceId: '1', hip: 5, proper: 'A' })])))
      .toEqual(requestLines(membershipKeys([record({ gaiaSourceId: '1', hip: 5, proper: 'B' })])));
  });
});

describe('glSuffix', () => {
  it('normalises both spellings to one suffix', () => {
    expect(['GJ 3207', 'Gl 3207', ' Gl 165A '].map(glSuffix)).toEqual(['3207', '3207', '165A']);
  });

  it('answers null for a blank or bare-prefix cell, and keeps a prefixless one', () => {
    expect([null, '', 'GJ ', '9140'].map(glSuffix)).toEqual([null, null, null, '9140']);
  });
});

describe('valueCohort', () => {
  const inCohort = valueCohort(new Set(['1']));

  it('keeps a row out only where the identity and the values are both first-hand', () => {
    expect(inCohort(record({ gaiaSourceId: '1', binding: GATE_REPRODUCED_BINDING, tyc: '7' }))).toBe(false);
    expect(inCohort(record({ gaiaSourceId: '1', binding: GATE_REPRODUCED_BINDING, hip: 7 }))).toBe(false);
  });

  it('admits a row Gaia states no complete solution for', () => {
    const row = record({ gaiaSourceId: '1', binding: GATE_REPRODUCED_BINDING, hip: 7, tyc: '1-2-1' });
    expect(valueCohort(new Set())(row)).toBe(true);
  });

  it.each(['simbad_corroborated', 'reviewed', 'none'] as const)('admits a %s binding', (binding) => {
    expect(inCohort(record({ gaiaSourceId: '1', binding, hip: 7 }))).toBe(true);
  });

  it('keeps out a magnitude-term row Gaia completes, printed ids or none: the row is Gaia\'s own source', () => {
    expect(inCohort(record({ gaiaSourceId: '1', binding: GAIA_NATIVE_BINDING, term: 'magnitude' }))).toBe(false);
    expect(valueCohort(new Set())(record({ gaiaSourceId: '1', binding: GAIA_NATIVE_BINDING, term: 'magnitude' }))).toBe(true);
  });

  it('admits a row carrying no printed identifier, and every row without a source_id', () => {
    expect(inCohort(record({ gaiaSourceId: '1', binding: GATE_REPRODUCED_BINDING, gl: 'GJ 9' }))).toBe(true);
    expect(inCohort(record({ hip: 7 }))).toBe(true);
  });
});

describe('gaiaCompleteSourceIds', () => {
  const row = (values: Partial<GaiaAstrometryCatalogRow>) => ({
    parallaxMas: 1, pmraMasyr: 2, pmdecMasyr: 2.5, radialVelocityKmS: 3, ...values,
  }) as GaiaAstrometryCatalogRow;

  it('needs a parallax, both proper-motion components and a radial velocity', () => {
    expect(gaiaCompleteSourceIds(new Map([
      ['10', row({})],
      ['20', row({ radialVelocityKmS: null })],
      ['30', row({ parallaxMas: null })],
      ['40', row({ pmdecMasyr: null })],
    ]))).toEqual(new Set(['10']));
  });
});
