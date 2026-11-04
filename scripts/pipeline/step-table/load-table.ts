// Resolves the step table against the disk and rejects it before anything runs. See README.md#load-time-rules.

import { lstatSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, resolve } from 'node:path';

import { build, type BuildFailure, type Metafile } from 'esbuild';

import type { DeclaredOutputs } from '../../util/emit-artifacts';
import { entryMetafile } from '../../util/import-closure';
import { REPO_ROOT } from '../../util/paths';
import { treeOf, treeRoots, type Tree } from '../../util/source-trees';
import { readManualRecord } from '../freshness';
import { pipelineTree, type PipelineTree } from '../pipeline-tree';
import {
  deriveGraph,
  type OutputClaims, type ResolvedStep, type StepEntry, type StepGraph, type StepTable,
} from './step-table-pure';

const OUTPUTS_MODULE_LEAVES = new Set(['scripts/util/emit-artifacts.ts', 'scripts/util/paths.ts']);
const SHARED_TREES: ReadonlySet<Tree> = new Set(['catalog-format', 'astro-core']);
const isWalkable = (module: string): boolean => SHARED_TREES.has(treeOf(module));
export const WALKABLE = `util/emit-artifacts, util/paths, ${treeRoots(SHARED_TREES).join(', ')}`;
export const TABLE_LOAD_BUILTINS: ReadonlySet<string> = new Set(['node:path', 'node:crypto']);
const builtinName = (spec: string): string => (isBuiltin(spec) && !spec.startsWith('node:') ? `node:${spec}` : spec);

export type Loaded =
  | { readonly kind: 'loaded'; readonly steps: ReadonlyMap<string, ResolvedStep>; readonly graph: StepGraph }
  | { readonly kind: 'rejected'; readonly problems: readonly string[] };

export interface LoadOptions {
  readonly root: string;
  /** A TypeScript build step's input files, absolute, from its entry. */
  readonly deriveInputs: (entry: string) => Promise<readonly string[]>;
}

const codePath = (path: string): string => resolve(REPO_ROOT, path);

export interface OutputsWalk {
  readonly accepted: ReadonlySet<string>;
  readonly trusted: ReadonlySet<string>;
  readonly problems: readonly string[];
}

/** Checked before any outputs module is imported, since importing one with
 *  side effects would run them. */
export async function walkOutputsModules(table: StepTable, tree: PipelineTree): Promise<OutputsWalk> {
  const modules = new Set(table.steps.flatMap((s) => (s.language === 'ts' ? [tree.abs(s.outputs.module)] : [])));
  if (modules.size === 0) return { accepted: new Set(), trusted: new Set(), problems: [] };
  const { inputs } = await entryMetafile([...modules]);
  const internal = (module: string): string[] => inputs[module].imports.filter((i) => !i.external).map((i) => i.path);
  const accepted = new Set<string>();
  const trusted = new Set<string>();
  const trust = (leaf: string): void => {
    for (const stack = [leaf]; stack.length > 0;) {
      const at = stack.pop()!;
      if (trusted.has(at)) continue;
      trusted.add(at);
      stack.push(...internal(at));
    }
  };
  const problems: string[] = [];
  const roots = Object.keys(inputs).filter((m) => modules.has(codePath(m)));
  for (const module of roots) {
    const seen = new Set<string>();
    const stack = internal(module);
    while (stack.length > 0) {
      const at = stack.pop()!;
      if (seen.has(at)) continue;
      seen.add(at);
      if (OUTPUTS_MODULE_LEAVES.has(at)) trust(at);
      else if (isWalkable(at)) {
        accepted.add(at);
        stack.push(...internal(at));
      } else problems.push(`outputs module ${module} reaches ${at}, beyond ${WALKABLE}`);
    }
  }
  problems.push(...await importTimeProblems({ checked: [...roots, ...accepted], trusted: [...trusted] }, inputs));
  return { accepted, trusted, problems };
}

/** Why importing each module, repo-relative and keyed in `inputs`, could act: a
 *  top-level await, a package import, or, for a checked module, a built-in beyond
 *  TABLE_LOAD_BUILTINS. The trusted leaves and their closure may import any built-in. */
export async function importTimeProblems(
  modules: { readonly checked: readonly string[]; readonly trusted: readonly string[] },
  inputs: Metafile['inputs'],
): Promise<string[]> {
  const problems: string[] = [];
  const scan = (list: readonly string[], allows: (spec: string) => boolean, allowed: string): void => {
    for (const module of list) {
      for (const { path, external } of inputs[module].imports) {
        if (external && !allows(path)) problems.push(`${module} imports ${path} at table load; only ${allowed} may be`);
      }
    }
  };
  scan(modules.checked, (spec) => TABLE_LOAD_BUILTINS.has(builtinName(spec)), [...TABLE_LOAD_BUILTINS].join(' and '));
  scan(modules.trusted, isBuiltin, 'Node built-ins');
  return [...problems, ...await topLevelAwaits([...modules.checked, ...modules.trusted])];
}

async function topLevelAwaits(modules: readonly string[]): Promise<string[]> {
  try {
    await build({
      entryPoints: modules.map(codePath),
      absWorkingDir: REPO_ROOT,
      platform: 'node',
      format: 'esm',
      supported: { 'top-level-await': false },
      write: false,
      outdir: 'unwritten',
      logLevel: 'silent',
    });
    return [];
  } catch (error) {
    if (!(error instanceof Error && 'errors' in error)) throw error;
    return (error as BuildFailure).errors.map((e) => `${e.location?.file ?? 'a table-load module'}: ${e.text}`);
  }
}

function isDeclaredOutputs(value: unknown): value is DeclaredOutputs {
  return typeof value === 'object' && value !== null && 'files' in value && 'families' in value;
}

async function outputClaims(step: StepEntry, tree: PipelineTree): Promise<OutputClaims> {
  if (step.language === 'python') {
    const families = step.kind === 'build' ? [] : (step.families ?? []).map((f) => ({ ...f, dir: tree.abs(f.dir) }));
    return { files: step.outputs.map(tree.abs), families };
  }
  const ref = step.outputs;
  const declared = (await import(tree.abs(ref.module)) as Record<string, unknown>)[ref.name];
  if (!isDeclaredOutputs(declared)) throw new Error(`${ref.module} exports no declareOutputs constant ${ref.name}`);
  return { files: Object.values<string>(declared.files), families: declared.families };
}

function symlinkedOutputs(root: string, outputs: OutputClaims): string[] {
  const linked = new Set<string>();
  for (const path of [...outputs.files, ...outputs.families.map((f) => f.dir)]) {
    for (let at = path; at.startsWith(`${root}/`); at = dirname(at)) {
      try {
        if (lstatSync(at).isSymbolicLink()) linked.add(at);
      } catch {
        continue;
      }
    }
  }
  return [...linked];
}

async function readsOf(step: StepEntry, tree: PipelineTree, options: LoadOptions): Promise<readonly string[]> {
  if (step.kind !== 'build') {
    const read = readManualRecord(step, tree.manualStamp(step.name));
    if (read.kind !== 'read') return [];
    const { record } = read;
    return [...Object.keys(record.stamp.inputs), ...(record.kind === 'pull' ? record.requestFrom : [])].map(tree.abs);
  }
  return step.language === 'ts' ? options.deriveInputs(tree.abs(step.entry)) : [];
}

export async function loadTable(table: StepTable, options: LoadOptions): Promise<Loaded> {
  const tree = pipelineTree(options.root);
  const walk = await walkOutputsModules(table, tree);
  if (walk.problems.length > 0) return { kind: 'rejected', problems: walk.problems };

  const resolved: ResolvedStep[] = await Promise.all(table.steps.map(async (step) => ({
    step,
    outputs: await outputClaims(step, tree),
    reads: await readsOf(step, tree, options),
  })));
  const problems = resolved.flatMap(({ step, outputs }) => (step.kind === 'build'
    ? symlinkedOutputs(options.root, outputs).map((p) => `${step.name} declares an output through a symlink: ${p}`)
    : []));
  if (problems.length > 0) return { kind: 'rejected', problems };

  const derived = deriveGraph(resolved, table.registryFiles.map(tree.abs));
  return derived.kind === 'rejected'
    ? derived
    : { kind: 'loaded', steps: new Map(resolved.map((s) => [s.step.name, s])), graph: derived.graph };
}
