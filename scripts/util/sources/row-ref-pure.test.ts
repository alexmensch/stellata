import { describe, expect, it } from 'vitest';

import { MULTIPLES_TSV } from '../../binaries/multiples-tsv';
import { BSC5 } from '../../catalog/classic-ids/bsc5-source';
import { CNS5 } from '../../catalog/classic-ids/cns5-source';
import { TYC2_HD } from '../../catalog/classic-ids/tyc2-hd-source';
import { HIP_PHOTOMETRY } from '../../catalog/photometry/hip-photometry-source';
import { MAGNITUDE_PULL } from '../../catalog/membership/magnitude-term/magnitude-pull-source';
import { INHERITED_SPINE } from '../../catalog/spine/inherited-spine-tsv';
import { sourceRowRef, sourceRowRefText } from './row-ref-pure';

describe('SourceRowRef', () => {
  it('cites a row of each keyed declaration by its text form', () => {
    expect(sourceRowRefText(sourceRowRef(MAGNITUDE_PULL, '4295806720'))).toBe('gaia-dr3:4295806720');
    expect(sourceRowRefText(sourceRowRef(INHERITED_SPINE, 4))).toBe('spine:4');
    expect(sourceRowRefText(sourceRowRef(MULTIPLES_TSV, { systemId: '00057+4549', comp: 'B' })))
      .toBe('multiples:00057+4549/B');
    expect(sourceRowRefText(sourceRowRef(TYC2_HD, '1004-180-1'))).toBe('iv25:1004-180-1');
    expect(sourceRowRefText(sourceRowRef(HIP_PHOTOMETRY, 85979))).toBe('i239:85979');
    expect(sourceRowRefText(sourceRowRef(CNS5, 12))).toBe('cns5:12');
  });

  it('refuses a declaration with no key, a wrongly typed row and a stand-in constant', () => {
    // @ts-expect-error BSC5 declares no rowKey
    expect(() => sourceRowRef(BSC5, 1)).not.toThrow();
    // @ts-expect-error the magnitude pull is keyed on a source_id string
    sourceRowRef(MAGNITUDE_PULL, 4295806720);
    // @ts-expect-error only a declaration carries the brand
    sourceRowRef({ file: 'f', rowKey: { id: 'x', text: (n: number) => String(n) } }, 1);
  });
});
