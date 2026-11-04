// The real step table loads, orders and stales as README.md#the-step-table--stepsts says.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { MULTIPLES_TSV } from '../../binaries/multiples-tsv';
import { CNS5 as CNS5_SOURCE } from '../../catalog/classic-ids/cns5-source';
import { REASON_CODES } from '../../catalog/lineage/reason-codes-tsv';
import { MEMBERSHIP_MANIFEST } from '../../catalog/membership/membership-manifest-tsv';
import { packageScripts } from '../../util/import-closure';
import { lfsContentReadable, publicFile, REPO_ROOT } from '../../util/paths';
import { PUBLIC_FILES } from '../../../src/catalog-format/public-artifacts/public-artifacts';
import { entryInputPaths } from '../../util/step-inputs';
import { describeStep } from '../freshness';
import { loadTable, type Loaded } from './load-table';
import { MANUAL_STEPS } from './manual-step-outputs';
import { pipelineTree } from '../pipeline-tree';
import { describesItself, isBuild, selectSteps, type Edge, type ReadsEdge } from './step-table-pure';
import { STEPS } from './steps';

const CNS5 = CNS5_SOURCE.file;
const MANIFEST = resolve(REPO_ROOT, MEMBERSHIP_MANIFEST.file);

let loaded: Extract<Loaded, { kind: 'loaded' }>;

beforeAll(async () => {
  const result = await loadTable(STEPS, { root: REPO_ROOT, deriveInputs: (entry) => entryInputPaths([entry]) });
  if (result.kind !== 'loaded') throw new Error(result.problems.join('\n'));
  loaded = result;
}, 60_000);

const edgeFiles = (from: string, to: string): string[] => loaded.graph.edges
  .filter((e: Edge): e is ReadsEdge => e.kind === 'reads' && e.from === from && e.to === to)
  .flatMap((e) => e.files.map((f) => relative(REPO_ROOT, f)));

const isBuildStep = (name: string): boolean => isBuild(loaded.steps.get(name)!.step);

describe('the step table', () => {
  it('runs the build steps in their data-flow order', () => {
    expect(loaded.graph.order.filter(isBuildStep)).toEqual([
      'lineage:codes', 'build:clouds', 'build:local-group', 'build:wgsn', 'build:binaries',
      'build:astrometry-request', 'build:classic-ids', 'build:membership', 'build:probes-sync', 'build:ephemerides-sync',
      'build:catalog', 'build:binaries-runtime', 'build:dust-sync', 'build:local-bubble-sync', 'build:cloud-surfaces-sync',
      'build:textures-sync',
    ]);
  });

  it('derives each TypeScript edge from a file the reader declares and the writer reads', () => {
    expect(edgeFiles('build:membership', 'build:catalog')).toEqual(expect.arrayContaining([
      MEMBERSHIP_MANIFEST.file, 'build/lineage/membership.tsv.gz',
    ]));
    expect(edgeFiles('lineage:codes', 'build:catalog')).toEqual([REASON_CODES.file]);
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

  it('keeps loops only through a manual step, and sets aside exactly the registry edges between the three allocating steps', () => {
    expect(loaded.graph.keptLoops.filter((e) => isBuildStep(e.from))).toEqual([]);
    const allocating = ['build:catalog', 'build:clouds', 'build:local-group'];
    expect(loaded.graph.registryEdges.map((e) => `${e.from} → ${e.to}`).sort()).toEqual(
      allocating.flatMap((from) => allocating.filter((to) => to !== from).map((to) => `${from} → ${to}`)).sort(),
    );
  });

  it('selects the whole catalogue chain upstream of build:binaries-runtime, so build:data never reads a stale row-index map', () => {
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

  it('runs every manual step by hand through record.ts, under its own name', () => {
    const scripts = packageScripts();
    const manual = STEPS.steps.filter((s) => !isBuild(s));
    expect(manual.map((s) => [s.name, scripts[s.name]])).toEqual(
      manual.map((s) => [s.name, `tsx scripts/pipeline/record.ts ${s.name}`]),
    );
  });

  it.skipIf(!lfsContentReadable(MANIFEST))('describes every pull: Python under python3 -I -S, TypeScript through tsx', () => {
    const tree = pipelineTree(REPO_ROOT);
    for (const step of MANUAL_STEPS.filter((s) => s.kind === 'pull')) {
      expect(describeStep(step, tree), step.name).toMatchObject({ kind: 'pull', query: expect.any(String) });
    }
  }, 60_000);

  it.skipIf(!existsSync(publicFile(PUBLIC_FILES.clouds)))('describes every describing bake under python3 -I -S', () => {
    const tree = pipelineTree(REPO_ROOT);
    const bakes = MANUAL_STEPS.filter((s) => s.kind === 'bake' && describesItself(s));
    expect(bakes.map((s) => s.name)).toEqual(['build:cloud-surfaces']);
    for (const step of bakes) {
      expect(describeStep(step, tree), step.name).toMatchObject({ kind: 'bake', request: expect.any(Array) });
    }
  });
});
