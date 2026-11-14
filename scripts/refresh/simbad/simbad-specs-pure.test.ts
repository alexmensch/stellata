import { describe, expect, it } from 'vitest';

import { replyJoiner } from './simbad-specs-pure';

describe('replyJoiner', () => {
  const join = replyJoiner(new Map([['WDSJ00001+0001Ab', 'Ab'], ['WDSJ00001+0001B', 'B']]));

  it('joins a key asked exactly, never its case-folded twin', () => {
    expect(join('WDSJ00001+0001Ab')).toEqual({ kind: 'asked', value: 'Ab' });
    expect(join('WDSJ00001+0001AB')).toEqual({ kind: 'folded' });
    expect(join('WDSJ00001+0001b')).toEqual({ kind: 'folded' });
  });

  it('names a key matching nothing even case-folded unasked', () => {
    expect(join('WDSJ00001+0001C')).toEqual({ kind: 'unasked' });
  });
});
