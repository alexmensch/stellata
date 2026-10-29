import { describe, expect, it } from 'vitest';

import { artifactText, isReadable } from '../../util/sources/source';
import { sourceRowRef, sourceRowRefText } from '../../util/sources/row-ref-pure';
import { readTable } from '../../util/tsv/table-pure';
import { INHERITED_SPINE, spineLine } from '../spine/inherited-spine-tsv';

function originKeys(): string[] {
  const keys: string[] = [];
  let index = 0;
  for (const row of readTable(INHERITED_SPINE.table, artifactText(INHERITED_SPINE))) {
    expect(row.line).toBe(spineLine(index));
    keys.push(sourceRowRefText(sourceRowRef(INHERITED_SPINE, spineLine(index))));
    index++;
  }
  return keys;
}

describe.skipIf(!isReadable(INHERITED_SPINE))('spine origin key', () => {
  it('is the physical line, unique, and identical across two reads', () => {
    const first = originKeys();
    expect(new Set(first).size).toBe(first.length);
    expect(originKeys()).toEqual(first);
    expect(first[0]).toBe('spine:2');
  });
});
