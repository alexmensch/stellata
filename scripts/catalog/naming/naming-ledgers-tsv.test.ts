import { describe, expect, it } from 'vitest';

import type { ParityRow } from './naming-parity-pure';
import { NAMING_DUPLICATES } from './naming-duplicates-tsv';
import { NAMING_PARITY } from './naming-parity-tsv';

const HEADER = 'key\told\tnew\tresolves';

describe('parity ledger codec', () => {
  it('round-trips a present row and an absent one', () => {
    const rows: ParityRow[] = [
      { key: 'synth:b', old: '31 Cyg H', record: { present: false } },
      { key: 'synth:a', old: 'HD 1 J', record: { present: true, new: '15 Mon J', resolves: false } },
    ];
    const text = NAMING_PARITY.serialize(rows);
    expect(text).toBe(`${HEADER}\nsynth:a\tHD 1 J\t15 Mon J\tno\nsynth:b\t31 Cyg H\t\tabsent\n`);
    expect(NAMING_PARITY.parse(text)).toEqual([rows[1], rows[0]]);
  });

  it('keeps a present record with no label apart from an absent one', () => {
    const [fallback, absent] = NAMING_PARITY.parse(
      `${HEADER}\nhip:1\tHIP 1 B\t\tno\nhip:2\tHIP 2 B\t\tabsent\n`,
    );
    expect(fallback.record).toEqual({ present: true, new: '', resolves: false });
    expect(absent.record).toEqual({ present: false });
  });

  it('refuses an unknown resolves value and an absent row with a label', () => {
    expect(() => NAMING_PARITY.parse(`${HEADER}\nhip:1\tX\tY\tmaybe\n`)).toThrow(/resolves/);
    expect(() => NAMING_PARITY.parse(`${HEADER}\nhip:1\tX\tY\tabsent\n`)).toThrow(/composes no label/);
  });
});

describe('duplicate ledger codec', () => {
  it('sorts by label and splits the claimant keys', () => {
    const text = NAMING_DUPLICATES.serialize([
      { label: 'b', keys: ['hip:2', 'hip:3'] },
      { label: 'a', keys: ['hip:1', 'hip:4'] },
    ]);
    expect(text).toBe('label\tkeys\na\thip:1|hip:4\nb\thip:2|hip:3\n');
    expect(NAMING_DUPLICATES.parse(text)[1]).toEqual({ label: 'b', keys: ['hip:2', 'hip:3'] });
  });
});

