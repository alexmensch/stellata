import { describe, expect, it } from 'vitest';

import {
  deriveGraph, selectSteps, writersOf,
  type Derived, type ResolvedStep, type StepGraph,
} from './step-table-pure';

function ts(name: string, outputs: string[], reads: string[] = []): ResolvedStep {
  return {
    step: { name, kind: 'build', language: 'ts', entry: `/r/${name}.ts`, outputs: { module: `/r/${name}-outputs.ts`, name: 'OUT' } },
    outputs: { files: outputs, families: [] },
    reads,
  };
}

function py(name: string, outputs: string[], after: string[]): ResolvedStep {
  return {
    step: { name, kind: 'build', language: 'python', entry: `/r/${name}.py`, outputs, after, snapshots: [] },
    outputs: { files: outputs, families: [] },
    reads: [],
  };
}

function pull(name: string, outputs: string[], reads: string[]): ResolvedStep {
  return {
    step: { name, kind: 'pull', language: 'python', entry: `/r/${name}.py`, outputs },
    outputs: { files: outputs, families: [] },
    reads,
  };
}

function ordered(d: Derived): StepGraph {
  if (d.kind !== 'ordered') throw new Error(`rejected: ${d.problems.join('; ')}`);
  return d.graph;
}

function problems(d: Derived): readonly string[] {
  if (d.kind !== 'rejected') throw new Error('expected the table to be rejected');
  return d.problems;
}

describe('deriveGraph', () => {
  it('orders a reader after the step that declares the file it reads, whatever the table order', () => {
    const g = ordered(deriveGraph([ts('b', ['/r/b.out'], ['/r/a.out']), ts('a', ['/r/a.out'])], []));
    expect(g.order).toEqual(['a', 'b']);
    expect(g.edges).toEqual([{ from: 'a', to: 'b', files: ['/r/a.out'] }]);
  });

  it('keeps table order between steps with no edge between them', () => {
    expect(ordered(deriveGraph([ts('z', ['/r/z']), ts('a', ['/r/a'])], [])).order).toEqual(['z', 'a']);
  });

  it('orders a Python build step by its declared after', () => {
    const g = ordered(deriveGraph([py('p', ['/r/p.out'], ['a']), ts('a', ['/r/a.out'])], []));
    expect(g.order).toEqual(['a', 'p']);
  });

  it('matches a read against a declared output family', () => {
    const a: ResolvedStep = { ...ts('a', []), outputs: { files: [], families: [{ dir: '/r/pub', member: /^chunk-\d+$/, stamped: true }] } };
    const g = ordered(deriveGraph([ts('b', ['/r/b'], ['/r/pub/chunk-3']), a], []));
    expect(g.order).toEqual(['a', 'b']);
  });

  it('rejects two steps declaring one output path', () => {
    expect(problems(deriveGraph([ts('a', ['/r/x']), ts('b', ['/r/x'])], [])))
      .toEqual(['/r/x is declared by both a and b']);
  });

  it('rejects a file one step declares inside another step\'s output family', () => {
    const a: ResolvedStep = { ...ts('a', []), outputs: { files: [], families: [{ dir: '/r/pub', member: /^c\.\d$/, stamped: true }] } };
    expect(problems(deriveGraph([a, ts('b', ['/r/pub/c.1'])], [])))
      .toEqual(['/r/pub/c.1 is declared by both a and b']);
  });

  it('rejects a cycle among build steps, naming it', () => {
    const d = deriveGraph([ts('a', ['/r/a'], ['/r/b']), ts('b', ['/r/b'], ['/r/a'])], []);
    expect(problems(d)).toEqual(['the build steps form a cycle: a → b → a']);
  });

  it('rejects two steps whose names give one stamp and lock file', () => {
    expect(problems(deriveGraph([ts('a:b', ['/r/x']), ts('a-b', ['/r/y'])], [])))
      .toEqual(['a-b shares its stamp and lock file a-b with an earlier step']);
  });

  it('rejects an after naming no step', () => {
    expect(problems(deriveGraph([py('p', ['/r/p'], ['ghost'])], [])))
      .toEqual(['p runs after ghost, which is not a step']);
  });

  it('drops exactly the registry edges between allocating steps, and no other edge of the loop', () => {
    const cat = ts('build:catalog', ['/r/sid/ledger.tsv', '/r/catalog.bin'], ['/r/sid/ledger.tsv', '/r/sid/cloud-ledger.tsv']);
    const stamp = ts('sid:stamp', ['/r/sid/cloud-ledger.tsv', '/r/clouds.json'], ['/r/sid/ledger.tsv', '/r/sid/cloud-ledger.tsv']);
    const g = ordered(deriveGraph([cat, stamp], ['/r/sid/ledger.tsv', '/r/sid/cloud-ledger.tsv']));
    expect(g.registryEdges).toEqual([
      { from: 'sid:stamp', to: 'build:catalog', files: ['/r/sid/cloud-ledger.tsv'] },
      { from: 'build:catalog', to: 'sid:stamp', files: ['/r/sid/ledger.tsv'] },
    ]);
    expect(g.edges).toEqual([]);
  });

  it('still rejects a loop through a file outside the registry', () => {
    const cat = ts('build:catalog', ['/r/sid/ledger.tsv', '/r/catalog.bin'], ['/r/clouds.json']);
    const stamp = ts('sid:stamp', ['/r/clouds.json'], ['/r/catalog.bin']);
    expect(problems(deriveGraph([cat, stamp], ['/r/sid/ledger.tsv']))[0]).toMatch(/cycle/);
  });

  it('orders a pull after the build that writes its request, and its reader after the pull', () => {
    const req = ts('request', ['/r/req.tsv']);
    const p = pull('astrometry', ['/r/astro.tsv'], ['/r/req.tsv']);
    const reader = ts('reader', ['/r/out'], ['/r/astro.tsv']);
    const g = ordered(deriveGraph([reader, p, req], []));
    expect(g.order).toEqual(['request', 'astrometry', 'reader']);
    expect(g.keptLoops).toEqual([]);
  });

  it('drops a pull\'s edge that would close a loop and lists it as kept, ordering the reader first', () => {
    const membership = ts('build:membership', ['/r/manifest.json'], ['/r/sptype.tsv']);
    const p = pull('simbad-sptype', ['/r/sptype.tsv'], ['/r/manifest.json']);
    const g = ordered(deriveGraph([p, membership], []));
    expect(g.keptLoops).toEqual([{ from: 'simbad-sptype', to: 'build:membership', files: ['/r/sptype.tsv'] }]);
    expect(g.order).toEqual(['build:membership', 'simbad-sptype']);
  });
});

describe('selectSteps', () => {
  const chain = ordered(deriveGraph([
    ts('a', ['/r/a']), ts('b', ['/r/b'], ['/r/a']), ts('c', ['/r/c'], ['/r/b']), ts('d', ['/r/d']),
  ], []));

  it('selects a target and everything upstream of it, in run order', () => {
    expect(selectSteps(chain, ['b'])).toEqual(['a', 'b']);
    expect(selectSteps(chain, ['c', 'd'])).toEqual(['a', 'b', 'c', 'd']);
  });

  it('reaches a pull through a kept loop, so the reader\'s run checks it', () => {
    const membership = ts('build:membership', ['/r/manifest.json'], ['/r/sptype.tsv']);
    const p = pull('simbad-sptype', ['/r/sptype.tsv'], ['/r/manifest.json']);
    expect(selectSteps(ordered(deriveGraph([p, membership], [])), ['build:membership']))
      .toEqual(['build:membership', 'simbad-sptype']);
  });
});

describe('writersOf', () => {
  it('names each step whose output a step reads, registry partners included', () => {
    const cat = ts('build:catalog', ['/r/sid/ledger.tsv'], ['/r/sid/cloud-ledger.tsv', '/r/m.tsv']);
    const stamp = ts('sid:stamp', ['/r/sid/cloud-ledger.tsv'], ['/r/sid/ledger.tsv']);
    const bin = ts('build:binaries', ['/r/m.tsv']);
    const g = ordered(deriveGraph([cat, stamp, bin], ['/r/sid/ledger.tsv', '/r/sid/cloud-ledger.tsv']));
    expect(writersOf(g, 'build:catalog').sort()).toEqual(['build:binaries', 'sid:stamp']);
  });
});
