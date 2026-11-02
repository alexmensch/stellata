// Resolves the step table against the disk and rejects it before anything runs. See README.md#load-time-rules.

import { lstatSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { DeclaredOutputs } from '../util/emit-artifacts';
import { entryMetafile } from '../util/import-closure';
import { REPO_ROOT } from '../util/paths';
import { readManualRecord } from './freshness';
import { pipelineDirs } from './pipeline-dirs';
import {
  deriveGraph,
  type OutputClaims, type OutputsRef, type ResolvedStep, type StepEntry, type StepGraph, type StepTable,
} from './step-table-pure';

const OUTPUTS_MODULE_MAY_IMPORT = (module: string): boolean => module === 'scripts/util/emit-artifacts.ts'
  || module === 'scripts/util/paths.ts'
  || /-pure\.ts$/.test(module);

export type Loaded =
  | { readonly kind: 'loaded'; readonly steps: ReadonlyMap<string, ResolvedStep>; readonly graph: StepGraph }
  | { readonly kind: 'rejected'; readonly problems: readonly string[] };

export interface LoadOptions {
  readonly root: string;
  /** A TypeScript build step's input files, absolute, from its entry. */
  readonly deriveInputs: (entry: string) => Promise<readonly string[]>;
}

const repoPath = (path: string): string => resolve(REPO_ROOT, path);

/** Checked before any outputs module is imported, since importing one with
 *  side effects would run them. */
async function impureOutputsModules(refs: readonly OutputsRef[]): Promise<string[]> {
  if (refs.length === 0) return [];
  const { inputs } = await entryMetafile(refs.map((r) => repoPath(r.module)));
  const modules = Object.keys(inputs).filter((m) => refs.some((r) => repoPath(r.module) === repoPath(m)));
  return modules.flatMap((module) => inputs[module].imports
    .filter((i) => !i.external && !OUTPUTS_MODULE_MAY_IMPORT(i.path))
    .map((i) => `outputs module ${module} imports ${i.path}, beyond util/emit-artifacts, util/paths and *-pure modules`));
}

function isDeclaredOutputs(value: unknown): value is DeclaredOutputs {
  return typeof value === 'object' && value !== null && 'files' in value && 'families' in value;
}

async function outputClaims(step: StepEntry): Promise<OutputClaims> {
  if (Array.isArray(step.outputs)) return { files: step.outputs.map(repoPath), families: [] };
  const ref = step.outputs as OutputsRef;
  const declared = (await import(repoPath(ref.module)) as Record<string, unknown>)[ref.name];
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

async function readsOf(step: StepEntry, root: string, options: LoadOptions): Promise<readonly string[]> {
  if (step.kind !== 'build') {
    const read = readManualRecord(step, pipelineDirs(root).manualStamp(step.name));
    if (read.kind !== 'read') return [];
    const { record } = read;
    return [...Object.keys(record.stamp.inputs), ...(record.kind === 'pull' ? record.requestFrom : [])].map(repoPath);
  }
  return step.language === 'ts' ? options.deriveInputs(repoPath(step.entry)) : [];
}

export async function loadTable(table: StepTable, options: LoadOptions): Promise<Loaded> {
  const refs = table.steps.flatMap((s) => (s.kind === 'build' && s.language === 'ts' ? [s.outputs] : []));
  const impure = await impureOutputsModules(refs);
  if (impure.length > 0) return { kind: 'rejected', problems: impure };

  const resolved: ResolvedStep[] = [];
  const problems: string[] = [];
  for (const step of table.steps) {
    const outputs = await outputClaims(step);
    if (step.kind === 'build') {
      problems.push(...symlinkedOutputs(options.root, outputs).map((p) => `${step.name} declares an output through a symlink: ${p}`));
    }
    resolved.push({ step, outputs, reads: await readsOf(step, options.root, options) });
  }
  if (problems.length > 0) return { kind: 'rejected', problems };

  const derived = deriveGraph(resolved, table.registryFiles.map(repoPath));
  return derived.kind === 'rejected'
    ? derived
    : { kind: 'loaded', steps: new Map(resolved.map((s) => [s.step.name, s])), graph: derived.graph };
}
