// The real step table loads, orders and stales as README.md#the-step-table--stepsts says.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { MULTIPLES_TSV } from '../binaries/multiples-tsv';
import { CNS5 as CNS5_SOURCE } from '../catalog/classic-ids/cns5-source';
import { REASON_CODES_FILE } from '../catalog/lineage/reason-codes-tsv';
import { MEMBERSHIP_MANIFEST_FILE } from '../catalog/membership/membership-manifest-tsv';
import { packageScripts } from '../util/import-closure';
import { REPO_ROOT } from '../util/paths';
import { entryInputPaths } from '../util/step-inputs';
import { loadTable, type Loaded } from './load-table';
import { selectSteps } from './step-table-pure';
import { STEPS } from './steps';

const CNS5 = CNS5_SOURCE.file;

let loaded: Extract<Loaded, { kind: 'loaded' }>;

beforeAll(async () => {
  const result = await loadTable(STEPS, { root: REPO_ROOT, deriveInputs: (entry) => entryInputPaths([entry]) });
  if (result.kind !== 'loaded') throw new Error(result.problems.join('\n'));
  loaded = result;
}, 60_000);

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

  it('is the one place a table step\'s entry is named: no package.json script or workflow runs one directly', () => {
    const workflows = join(REPO_ROOT, '.github/workflows');
    const texts = [
      ...Object.values(packageScripts()),
      ...readdirSync(workflows).filter((f) => f.endsWith('.yml')).map((f) => readFileSync(join(workflows, f), 'utf8')),
    ];
    expect(STEPS.steps.map((s) => s.entry).filter((entry) => texts.some((text) => text.includes(entry)))).toEqual([]);
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
    for (const name of ['build:membership', 'build:catalog']) {
      expect(loaded.steps.get(name)!.reads.map((p) => relative(REPO_ROOT, p)), name).toContain(CNS5);
    }
    expect(loaded.graph.order.indexOf('build:membership')).toBeLessThan(loaded.graph.order.indexOf('build:catalog'));
  });
});
