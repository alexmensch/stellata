import { describe, expect, it } from 'vitest';

import { closureWithSiblings } from './import-closure-pure';

describe('closureWithSiblings', () => {
  it('adds the non-code files beside closure modules, and nothing elsewhere', () => {
    const closure = new Set(['scripts/cat/build.ts', 'src/client/util/helper.ts']);
    const files = [
      'scripts/cat/build.ts',
      'scripts/cat/build-expected.json',
      'scripts/cat/other.ts',
      'scripts/cat/README.md',
      'scripts/cat/stamp.py',
      'scripts/cat/sub/deep-expected.json',
      'src/client/util/table.tsv',
      'scripts/elsewhere/x-expected.json',
    ];
    expect(closureWithSiblings(closure, files)).toEqual([
      'scripts/cat/build-expected.json',
      'scripts/cat/build.ts',
      'src/client/util/helper.ts',
      'src/client/util/table.tsv',
    ]);
  });

  it('keeps a closure module the file listing lacks', () => {
    expect(closureWithSiblings(new Set(['scripts/cat/new.ts']), [])).toEqual(['scripts/cat/new.ts']);
  });
});
