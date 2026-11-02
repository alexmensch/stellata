// Resolves the step table against the disk and rejects it before anything runs. See README.md#load-time-rules.

import { lstatSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { DeclaredOutputs } from '../util/emit-artifacts';
import { entryMetafile } from '../util/import-closure';
import { REPO_ROOT } from '../util/paths';
import { readManualRecord } from './freshness';
import { pipelineTree, type PipelineTree } from './pipeline-tree';
import {
  deriveGraph,
  type OutputClaims, type OutputsRef, type ResolvedStep, type StepEntry, type StepGraph, type StepTable,
} from './step-table-pure';

const OUTPUTS_MODULE_LEAVES = new Set(['scripts/util/emit-artifacts.ts', 'scripts/util/paths.ts']);
const isPure = (module: string): boolean => /-pure\.ts$/.test(module);

export type Loaded =
  | { readonly kind: 'loaded'; readonly steps: ReadonlyMap<string, ResolvedStep>; readonly graph: StepGraph }
  | { readonly kind: 'rejected'; readonly problems: readonly string[] };

export interface LoadOptions {
  readonly root: string;
  /** A TypeScript build step's input files, absolute, from its entry. */
  readonly deriveInputs: (entry: string) => Promise<readonly string[]>;
}

const codePath = (path: string): string => resolve(REPO_ROOT, path);

/** Checked before any outputs module is imported, since importing one with
 *  side effects would run them. */
async function impureOutputsModules(refs: readonly OutputsRef[], tree: PipelineTree): Promise<string[]> {
  if (refs.length === 0) return [];
  const modules = new Set(refs.map((r) => tree.abs(r.module)));
  const { inputs } = await entryMetafile([...modules]);
  const internal = (module: string): string[] => inputs[module].imports.filter((i) => !i.external).map((i) => i.path);
  const problems: string[] = [];
  for (const module of Object.keys(inputs).filter((m) => modules.has(codePath(m)))) {
    const seen = new Set<string>();
    const stack = internal(module);
    while (stack.length > 0) {
      const at = stack.pop()!;
      if (seen.has(at) || OUTPUTS_MODULE_LEAVES.has(at)) continue;
      seen.add(at);
      if (isPure(at)) stack.push(...internal(at));
      else problems.push(`outputs module ${module} reaches ${at}, beyond util/emit-artifacts, util/paths and *-pure modules`);
    }
  }
  return problems;
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
  const refs = table.steps.flatMap((s) => (s.language === 'ts' ? [s.outputs] : []));
  const impure = await impureOutputsModules(refs, tree);
  if (impure.length > 0) return { kind: 'rejected', problems: impure };

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
