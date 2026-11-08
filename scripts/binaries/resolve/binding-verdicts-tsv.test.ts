import { describe, expect, it } from 'vitest';

import { auditBindingIntegrity } from './binding-audit-pure';
import { BINDING_VERDICTS_TSV, bindingVerdictRow } from './binding-verdicts-tsv';
import { astrometryMap, biAstro, biSystem, indices } from './resolve-fixture';

describe('binding-integrity-verdicts.tsv', () => {
  const { pairs, components } = biSystem([
    ['AB', 3.0, 0.0, ['100', null], ['200', null]],
    ['AC', 10.0, 0.0, ['100', null], ['200', null]],
  ]);
  const verdicts = auditBindingIntegrity(
    pairs, components, indices({ srcToAstrometry: astrometryMap([biAstro('100', 0, 0), biAstro('200', 0, 3)]) }), new Map(),
  );

  it('writes the header then one line per verdict, and reads back what it wrote', () => {
    const rows = verdicts.map(bindingVerdictRow);
    const text = BINDING_VERDICTS_TSV.serialize(rows);
    const lines = text.trimEnd().split('\n');
    expect(lines[0].split('\t')).toEqual([...BINDING_VERDICTS_TSV.columns]);
    expect(lines).toHaveLength(verdicts.length + 1);
    expect(BINDING_VERDICTS_TSV.parse(text)).toEqual(rows);
  });

  it('prints candidates error ascending as label=err@sep, inf when unreachable', () => {
    const row = bindingVerdictRow({
      ...verdicts[0],
      candidates: [
        { label: 'C', tokens: ['C'], sourceId: '200', errArcsec: Infinity, predictedSepArcsec: 0 },
        { label: 'B', tokens: ['B'], sourceId: '200', errArcsec: 0.12345, predictedSepArcsec: 3.04 },
      ],
    });
    expect(row.candidates).toBe('B=0.123@3.0;C=inf@0.0');
  });
});
