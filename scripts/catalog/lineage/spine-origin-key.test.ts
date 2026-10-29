import { describe, expect, it } from 'vitest';

import { artifactText, isReadable } from '../../util/sources/source';
import { sourceRowRef, sourceRowRefText } from '../../util/sources/row-ref-pure';
import { readTable } from '../../util/tsv/table-pure';
import { INHERITED_SPINE, spineLine } from '../spine/inherited-spine-tsv';

describe.skipIf(!isReadable(INHERITED_SPINE))('spine origin key', () => {
  it('is each row\'s physical line, as the reader counts it, and no two rows share one', () => {
    const keys: string[] = [];
    let index = 0;
    for (const row of readTable(INHERITED_SPINE.table, artifactText(INHERITED_SPINE))) {
      expect(row.line).toBe(spineLine(index));
      keys.push(sourceRowRefText(sourceRowRef(INHERITED_SPINE, spineLine(index))));
      index++;
    }
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe('spine:2');
  });
});
