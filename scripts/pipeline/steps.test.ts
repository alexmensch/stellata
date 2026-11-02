// The real step table loads, orders and stales as README.md#the-step-table--stepsts says.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MULTIPLES_TSV } from '../binaries/multiples-tsv';
import { CNS5 as CNS5_SOURCE } from '../catalog/classic-ids/cns5-source';
import { REASON_CODES_FILE } from '../catalog/lineage/reason-codes-tsv';
import { MEMBERSHIP_MANIFEST_FILE } from '../catalog/membership/membership-manifest-tsv';
import { fileHashes } from '../util/build-stamp';
import { REPO_ROOT } from '../util/paths';
import { stepFileName } from '../util/stamp-path-pure';
import { entryInputPaths } from '../util/step-inputs';
import { derivedFreshness } from './freshness';
import { loadTable, type Loaded } from './load-table';
import { pipelineTree } from './pipeline-tree';
import { selectSteps } from './step-table-pure';
import { STEPS } from './steps';

const CNS5 = CNS5_SOURCE.file;

let loaded: Extract<Loaded, { kind: 'loaded' }>;
let scratch: string;

beforeAll(async () => {
  const result = await loadTable(STEPS, { root: REPO_ROOT, deriveInputs: (entry) => entryInputPaths([entry]) });
  if (result.kind !== 'loaded') throw new Error(result.problems.join('\n'));
  loaded = result;
  scratch = mkdtempSync(join(tmpdir(), 'steps-test-'));
}, 60_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const edgeFiles = (from: string, to: string): string[] => loaded.graph.edges
  .filter((e) => e.from === from && e.to === to).flatMap((e) => e.files.map((f) => relative(REPO_ROOT, f)));

describe('the step table', () => {
  it('runs the catalogue chain in its data-flow order', () => {
    expect(loaded.graph.order).toEqual([
      'build:binaries', 'lineage:codes', 'build:classic-ids', 'build:wgsn', 'build:astrometry-request',
      'build:membership', 'build:catalog', 'build:binaries-runtime',
    ]);
  });

  it('derives each TypeScript edge from a file the reader declares and the writer reads', () => {
    expect(edgeFiles('build:membership', 'build:catalog')).toEqual(expect.arrayContaining([
      MEMBERSHIP_MANIFEST_FILE, 'build/lineage/membership.tsv.gz',
    ]));
    expect(edgeFiles('lineage:codes', 'build:catalog')).toEqual([REASON_CODES_FILE]);
    expect(edgeFiles('build:binaries', 'build:membership')).toEqual([MULTIPLES_TSV.file]);
  });

  it('keeps no loop and sets aside no registry edge while build:catalog is the only allocating step on it', () => {
    expect(loaded.graph.keptLoops).toEqual([]);
    expect(loaded.graph.registryEdges).toEqual([]);
  });

  it('selects the whole catalogue chain upstream of build:binaries-runtime, so build:layers never reads a stale row-index map', () => {
    const selected = selectSteps(loaded.graph, ['build:binaries-runtime']);
    expect(selected.indexOf('build:catalog')).toBeLessThan(selected.indexOf('build:binaries-runtime'));
    expect(selected).toEqual(expect.arrayContaining(['build:binaries', 'build:membership', 'build:catalog']));
  });

  it('stales build:membership and build:catalog on an edit to cns5.tsv, membership first', () => {
    const tree = pipelineTree(REPO_ROOT);
    for (const name of ['build:membership', 'build:catalog']) {
      const step = loaded.steps.get(name)!;
      const inputs = fileHashes([...step.reads], REPO_ROOT);
      expect(Object.keys(inputs), name).toContain(CNS5);
      const stamp = join(scratch, `${stepFileName(name)}.json`);
      writeFileSync(stamp, JSON.stringify({ inputs, outputs: {} }));
      const outputs = { files: [], families: [] };
      expect(derivedFreshness(stamp, outputs, inputs, tree), name).toEqual({ kind: 'fresh' });
      const edited = { ...inputs, [CNS5]: 'edited' };
      expect(derivedFreshness(stamp, outputs, edited, tree), name).toEqual({ kind: 'stale', changed: [CNS5] });
    }
    expect(loaded.graph.order.indexOf('build:membership')).toBeLessThan(loaded.graph.order.indexOf('build:catalog'));
  });
});
