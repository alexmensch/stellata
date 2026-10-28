import { describe, expect, it } from 'vitest';

import { closureWithSiblings, scriptParts, tsxEntries, tsxEntry } from './import-closure-pure';

describe('tsxEntry', () => {
  it('reads the entry of a single tsx script', () => {
    expect(tsxEntry({ 'build:x': 'tsx scripts/x/build-x.ts' }, 'build:x')).toBe('scripts/x/build-x.ts');
  });

  it('refuses a chained or missing script rather than keying half of it', () => {
    expect(() => tsxEntry({ 'build:x': 'tsx a.ts && tsx b.ts' }, 'build:x')).toThrow(/build:x/);
    expect(() => tsxEntry({}, 'build:y')).toThrow(/build:y/);
  });
});

describe('scriptParts / tsxEntries', () => {
  const scripts = {
    'build:lg': 'tsx scripts/lg/build.ts && tsx scripts/sid/stamp.ts local-group',
    'build:clouds': 'python3 scripts/clouds/build.py && tsx scripts/sid/stamp.ts clouds',
    'build:data': 'pnpm run build:a && pnpm run build:b',
    'build:client': 'vite build',
  };

  it('classifies each chained command', () => {
    expect(scriptParts(scripts, 'build:clouds')).toEqual([
      { kind: 'python', entry: 'scripts/clouds/build.py' },
      { kind: 'tsx', entry: 'scripts/sid/stamp.ts', args: ['clouds'] },
    ]);
    expect(scriptParts(scripts, 'build:data').map((p) => p.kind)).toEqual(['pnpm', 'pnpm']);
    expect(scriptParts(scripts, 'build:client')).toEqual([{ kind: 'other', command: 'vite build' }]);
  });

  it('lists every tsx entry a chained script runs', () => {
    expect(tsxEntries(scripts, 'build:lg')).toEqual(['scripts/lg/build.ts', 'scripts/sid/stamp.ts']);
    expect(tsxEntries(scripts, 'build:data')).toEqual([]);
  });

  it('refuses a missing script', () => {
    expect(() => scriptParts(scripts, 'build:none')).toThrow(/build:none/);
  });
});

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
