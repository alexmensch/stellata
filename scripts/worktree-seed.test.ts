// Every .worktreeinclude pattern is an output, or a stamp, of a step build:seed runs.
import { readFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { loadedRepoTable } from './pipeline/step-table/repo-table';
import { expandTargets, isBuild, selectSteps } from './pipeline/step-table/step-table-pure';
import { STEPS } from './pipeline/step-table/steps';
import { isMemberName, type OutputFamily } from './util/emit-artifacts';
import { escapeRegExp } from './util/escape-regexp';
import { packageScripts } from './util/import-closure';
import { scriptParts } from './util/import-closure-pure';
import { REPO_ROOT } from './util/paths';
import { stampPath } from './util/stamp-path-pure';

interface StepOutputs {
  readonly files: readonly string[];
  readonly families: readonly OutputFamily[];
}

const RUNNER = 'scripts/pipeline/run.ts';
const rel = (path: string): string => relative(REPO_ROOT, path);

let outputsOf: ReadonlyMap<string, StepOutputs>;
let seedSteps: readonly string[];

beforeAll(async () => {
  const loaded = await loadedRepoTable();
  const parts = scriptParts(packageScripts(), 'build:data');
  const targets = parts.flatMap((p) => (p.kind === 'tsx' && p.entry === RUNNER ? p.args : []));
  if (targets.length === 0 || parts.length !== 1) throw new Error('build:data must be one run.ts call');
  seedSteps = selectSteps(loaded.graph, expandTargets(STEPS.steps, targets))
    .filter((name) => isBuild(loaded.steps.get(name)!.step));
  outputsOf = new Map([...loaded.steps].map(([name, { outputs }]) => [name, {
    files: [...outputs.files, stampPath(name)].map(rel),
    families: outputs.families.filter((f) => f.stamped).map((f) => ({ ...f, dir: rel(f.dir) })),
  }]));
}, 60_000);

function globRegExp(pattern: string): RegExp {
  return new RegExp(`^${pattern.split('*').map(escapeRegExp).join('[^/]*')}$`);
}

/** A bare `*` covers a whole family; any other pattern, the family whose member its `*`s read as `0` name. */
function covers(outputs: StepOutputs, pattern: string): boolean {
  const glob = globRegExp(pattern);
  const name = basename(pattern);
  return outputs.files.some((file) => glob.test(file))
    || outputs.families.some((f) => f.dir === dirname(pattern) && (name === '*' || isMemberName(f, name.replaceAll('*', '0'))));
}

const seedOutputs = (): StepOutputs[] => seedSteps.map((step) => outputsOf.get(step)!);

const SEEDABLE = /^(public|build)\//;

const PATTERNS = readFileSync(resolve(REPO_ROOT, '.worktreeinclude'), 'utf8')
  .split('\n').map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#'));

describe('.worktreeinclude', () => {
  it('lists only outputs and stamps of the steps build:seed runs', () => {
    expect(PATTERNS.filter((pattern) => !seedOutputs().some((o) => covers(o, pattern)))).toEqual([]);
  });

  it('lists every gitignored output file, stamped output family and stamp of those steps', () => {
    const globs = PATTERNS.map(globRegExp);
    const files = seedOutputs().flatMap((o) => o.files)
      .filter((file) => SEEDABLE.test(file) && !globs.some((glob) => glob.test(file)));
    const families = seedOutputs().flatMap((o) => o.families)
      .filter((f) => SEEDABLE.test(`${f.dir}/`) && !PATTERNS.some((pattern) => covers({ files: [], families: [f] }, pattern)))
      .map((f) => `${f.dir}/${f.member instanceof RegExp ? f.member.source : f.member.join('|')}`);
    expect([...files, ...families]).toEqual([]);
  });

  it('loses membership\'s lineage baseline without build:membership', () => {
    const others = new Set(seedSteps.filter((step) => step !== 'build:membership').flatMap((step) => outputsOf.get(step)!.files));
    expect(outputsOf.get('build:membership')!.files.filter((f) => f.startsWith('build/lineage/') && !others.has(f)))
      .toEqual(['build/lineage/membership.tsv.gz', 'build/lineage/identity.tsv.gz', 'build/lineage/membership.header.json']);
  });
});
