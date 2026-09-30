import { describe, expect, it } from 'vitest';

import { diffOutputHashes, formatDifference, isIdentical } from './output-identity-pure';

describe('diffOutputHashes', () => {
  it('reports identical hash sets as identical', () => {
    const d = diffOutputHashes({ a: '1', b: '2' }, { b: '2', a: '1' });
    expect(isIdentical(d)).toBe(true);
  });

  it('names each changed, appeared and vanished output', () => {
    const d = diffOutputHashes(
      { same: '1', edited: '2', gone: '3', 'was-absent': null },
      { same: '1', edited: '9', 'was-absent': '4', fresh: '5' },
    );
    expect(d).toEqual({
      changed: ['edited'],
      appeared: ['fresh', 'was-absent'],
      vanished: ['gone'],
    });
    expect(isIdentical(d)).toBe(false);
    expect(formatDifference(d)).toEqual([
      'changed   edited',
      'appeared  fresh',
      'appeared  was-absent',
      'vanished  gone',
    ]);
  });

  it('treats an output absent on both sides as unchanged', () => {
    expect(isIdentical(diffOutputHashes({ x: null }, {}))).toBe(true);
  });
});
