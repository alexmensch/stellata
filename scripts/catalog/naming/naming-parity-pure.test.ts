import { describe, expect, it } from 'vitest';

import { formatParityLedger, parseParityLedger, type ParityRow } from './naming-parity-pure';

const HEADER = 'key\told\tnew\tresolves';

describe('parity ledger codec', () => {
  it('round-trips a present row and an absent one', () => {
    const rows: ParityRow[] = [
      { key: 'synth:a', old: 'HD 1 J', record: { present: true, new: '15 Mon J', resolves: false } },
      { key: 'synth:b', old: '31 Cyg H', record: { present: false } },
    ];
    const text = formatParityLedger(rows);
    expect(text).toBe(`${HEADER}\nsynth:a\tHD 1 J\t15 Mon J\tno\nsynth:b\t31 Cyg H\t\tabsent\n`);
    expect(parseParityLedger(text)).toEqual(rows);
  });

  it('keeps a present record with no label apart from an absent one', () => {
    const [fallback, absent] = parseParityLedger(
      `${HEADER}\nhip:1\tHIP 1 B\t\tno\nhip:2\tHIP 2 B\t\tabsent\n`,
    );
    expect(fallback.record).toEqual({ present: true, new: '', resolves: false });
    expect(absent.record).toEqual({ present: false });
  });

  it('refuses an unknown resolves value and an absent row with a label', () => {
    expect(() => parseParityLedger(`${HEADER}\nhip:1\tX\tY\tmaybe\n`)).toThrow(/resolves must be/);
    expect(() => parseParityLedger(`${HEADER}\nhip:1\tX\tY\tabsent\n`)).toThrow(/composes no label/);
  });
});
