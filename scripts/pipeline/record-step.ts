// Runs one manual step by hand and writes its committed record. See README.md#recording-a-manual-step--recordts.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { fileHashes, type FileHashes, type RecordedReads } from '../util/build-stamp';
import {
  describeStep, manualFreshness, pullQueryHash, requestHash, stampedOutputs, writeManualRecord,
  type Description, type ManualRecord,
} from './freshness';
import type { Loaded } from './load-table';
import { holdStepLocks } from './locks';
import { pipelineTree, type PipelineTree } from './pipeline-tree';
import { exec, runRecorded, TSX } from './processes';
import { undeclaredWrites, type RunRecord } from './python-run-pure';
import {
  claims, describesItself, isBuild,
  type ManualStep, type ResolvedStep,
} from './step-table-pure';

export interface RecordOptions {
  readonly root: string;
  readonly step: string;
  readonly force: boolean;
  readonly args: readonly string[];
  readonly deriveInputs: (entry: string) => Promise<readonly string[]>;
  readonly log: (line: string) => void;
}

export type RecordOutcome =
  | { readonly kind: 'fresh' }
  | { readonly kind: 'recorded'; readonly record: ManualRecord }
  | { readonly kind: 'partial' }
  | { readonly kind: 'failed'; readonly reason: string };

type Loads = Extract<Loaded, { kind: 'loaded' }>;

const CODE = /\.(py|ts|mts)$/;

function ignored(paths: readonly string[], root: string): Set<string> {
  if (paths.length === 0) return new Set();
  const run = spawnSync('git', ['check-ignore', '--stdin'], { cwd: root, input: paths.join('\n'), encoding: 'utf8' });
  if (run.status !== 0 && run.status !== 1) throw new Error(`git check-ignore exited ${run.status}: ${run.stderr.trim()}`);
  return new Set(run.stdout.split('\n').filter(Boolean));
}

function inputFilter(resolved: ResolvedStep, described: Description | null, candidates: readonly string[], tree: PipelineTree) {
  const projected = new Set((described?.requestFrom ?? []).map(tree.abs));
  const skip = ignored(candidates, tree.root);
  return (path: string): boolean => !claims(resolved.outputs, path) && !projected.has(path) && !skip.has(path)
    && !(resolved.step.kind === 'pull' && CODE.test(path));
}

interface Reads {
  readonly inputs: FileHashes;
  readonly recorded?: RecordedReads;
  readonly services: readonly string[];
}

function pick<V>(byPath: Readonly<Record<string, V>>, keep: (path: string) => boolean): Record<string, V> {
  return Object.fromEntries(Object.entries(byPath).filter(([p]) => keep(p)));
}

function recordedReads(run: RunRecord, keep: (path: string) => boolean, tree: PipelineTree): Reads {
  const listings = pick(run.listings, keep);
  const probes = pick(run.probes, keep);
  const any = Object.keys(listings).length + Object.keys(probes).length > 0;
  return {
    inputs: tree.rekey(pick(run.reads, keep)),
    recorded: any ? { listings: tree.rekey(listings), probes: tree.rekey(probes) } : undefined,
    services: run.services,
  };
}

function manualRecord(step: ManualStep, described: Description | null, reads: Reads, outputs: FileHashes): ManualRecord {
  const stamp = reads.recorded ? { inputs: reads.inputs, outputs, recorded: reads.recorded } : { inputs: reads.inputs, outputs };
  const projected = {
    request: described?.request ? requestHash(described.request) : undefined,
    requestFrom: described?.requestFrom ?? [],
  };
  if (step.kind === 'bake') return { kind: 'bake', stamp, ...projected };
  if (described?.kind !== 'pull') throw new Error(`${step.name} is a pull, so it must describe itself`);
  return { kind: 'pull', stamp, query: pullQueryHash(described), answeredBy: reads.services, release: described.release, ...projected };
}

async function runAndRead(
  resolved: ResolvedStep & { readonly step: ManualStep }, described: Description | null, options: RecordOptions, tree: PipelineTree,
): Promise<Reads | string> {
  const { step } = resolved;
  const entry = tree.abs(step.entry);
  if (step.language === 'ts') {
    const code = await exec(TSX, [entry, ...options.args], process.env);
    if (code !== 0) return `exited ${code}`;
    const derived = await options.deriveInputs(entry);
    const keep = inputFilter(resolved, described, derived, tree);
    return { inputs: fileHashes(derived.filter(keep), tree.root), services: [] };
  }
  const recorded = await runRecorded(tree, step.name, entry, options.args, process.env);
  if (recorded.kind === 'exited') return `exited ${recorded.code}`;
  const { run } = recorded;
  const touched = [...Object.keys(run.reads), ...Object.keys(run.listings), ...Object.keys(run.probes), ...run.writes];
  const scratch = ignored(touched, tree.root);
  const problems = undeclaredWrites(resolved, run.writes.filter((p) => !scratch.has(p)));
  if (problems.length > 0) return problems.join('; ');
  return recordedReads(run, inputFilter(resolved, described, touched, tree), tree);
}

export async function recordStep(loaded: Loads, options: RecordOptions): Promise<RecordOutcome> {
  const resolved = loaded.steps.get(options.step);
  if (!resolved) throw new Error(`no step named ${options.step}`);
  const { step } = resolved;
  if (isBuild(step)) throw new Error(`${step.name} is a build step: run it with run.ts`);
  const manual = { ...resolved, step };
  const tree = pipelineTree(options.root);
  const held = await holdStepLocks(tree.locks, loaded, step.name, true, options.log);
  try {
    const partial = options.args.length > 0;
    if (!partial && !options.force && manualFreshness(step, resolved.outputs, tree).kind === 'fresh') return { kind: 'fresh' };
    const described = describesItself(step) ? describeStep(step, tree) : null;
    const reads = await runAndRead(manual, described, options, tree);
    if (typeof reads === 'string') return { kind: 'failed', reason: reads };
    if (partial) return { kind: 'partial' };
    const files = stampedOutputs(resolved.outputs);
    const missing = files.filter((p) => !existsSync(p));
    if (missing.length > 0) return { kind: 'failed', reason: `declared outputs not written: ${missing.map(tree.rel).join(', ')}` };
    if (held.died()) return { kind: 'failed', reason: 'its lock holder died while it ran' };
    const record = manualRecord(step, described, reads, fileHashes(files, tree.root));
    writeManualRecord(tree.manualStamp(step.name), record);
    return { kind: 'recorded', record };
  } finally {
    await held.release();
  }
}
