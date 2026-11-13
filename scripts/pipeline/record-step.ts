// Runs one manual step by hand and writes its committed record. See README.md#recording-a-manual-step--recordts.

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

import { ANSWERED_BY_ENV, readAnsweredBy } from '../util/answered-by';
import {
  fileHashes, ignoredPaths, inputHashes, listingHashes, recordedInputs, type FileHashes, type RecordedReads,
} from '../util/build-stamp';
import { CODE_FILE } from '../util/import-closure-pure';
import {
  manualDescription, manualFreshness, pullQueryHash, requestHash, stampedOutputs, writeManualRecord,
  type Description, type ManualRecord,
} from './freshness';
import type { LoadedTable } from './step-table/load-table';
import { holdStepLocks } from './locks';
import { pipelineTree, type PipelineTree } from './pipeline-tree';
import { runRecorded, runTs, type RunRecord } from './processes';
import {
  claims, isBuild,
  type ManualStep, type ResolvedStep,
} from './step-table/step-table-pure';

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


function inputFilter(resolved: ResolvedStep, described: Description | null, skip: ReadonlySet<string>, tree: PipelineTree) {
  const projected = new Set((described?.requestFrom ?? []).map(tree.abs));
  return (path: string): boolean => !claims(resolved.outputs, path) && !projected.has(path) && !skip.has(path)
    && !(resolved.step.kind === 'pull' && CODE_FILE.test(path));
}

function filesBesideCode(paths: readonly string[]): Set<string> {
  const codeDirs = new Set(paths.filter((p) => CODE_FILE.test(p)).map((p) => dirname(p)));
  return new Set(paths.filter((p) => !CODE_FILE.test(p) && codeDirs.has(dirname(p))));
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
    inputs: recordedInputs(tree.rekey(pick(run.reads, keep)), tree.root),
    recorded: any ? { listings: tree.rekey(listingHashes(listings, tree.root)), probes: tree.rekey(probes) } : undefined,
    services: run.services,
  };
}

function manualRecord(step: ManualStep, described: Description | null, reads: Reads, outputs: FileHashes): ManualRecord {
  const projected = {
    stamp: { inputs: reads.inputs, outputs },
    recorded: reads.recorded,
    request: described?.request ? requestHash(described.request) : undefined,
    requestFrom: described?.requestFrom ?? [],
  };
  if (step.kind === 'bake') return { kind: 'bake', ...projected };
  if (described?.kind !== 'pull') throw new Error(`${step.name} is a pull, so it must describe itself`);
  return { kind: 'pull', query: pullQueryHash(described), answeredBy: reads.services, release: described.release, ...projected };
}

async function runAndRead(
  resolved: ResolvedStep & { readonly step: ManualStep }, described: Description | null, options: RecordOptions, tree: PipelineTree,
): Promise<Reads | string> {
  const { step } = resolved;
  const entry = tree.abs(step.entry);
  if (step.language === 'ts') {
    const derived = await options.deriveInputs(entry);
    const keep = inputFilter(resolved, described, ignoredPaths(derived, tree.root), tree);
    const besideCode = step.kind === 'pull' ? filesBesideCode(derived) : new Set<string>();
    const inputs = inputHashes(derived.filter((p) => keep(p) && !besideCode.has(p)), tree.root);
    const answeredBy = tree.answeredBy(step.name);
    mkdirSync(dirname(answeredBy), { recursive: true });
    rmSync(answeredBy, { force: true });
    try {
      const code = await runTs(tree, step.name, entry, options.args, inputs, { ...process.env, [ANSWERED_BY_ENV]: answeredBy });
      return code === 0 ? { inputs, services: readAnsweredBy(answeredBy) } : `exited ${code}`;
    } finally {
      rmSync(answeredBy, { force: true });
    }
  }
  const recorded = await runRecorded(tree, step.name, entry, options.args, process.env);
  if (recorded.kind === 'exited') return `exited ${recorded.code}`;
  const { run } = recorded;
  const touched = [...Object.keys(run.reads), ...Object.keys(run.probes), ...run.writes];
  const scratch = ignoredPaths(touched, tree.root);
  const undeclared = run.writes.filter((p) => !scratch.has(p) && !claims(resolved.outputs, p));
  if (undeclared.length > 0) return undeclared.map((p) => `${step.name} wrote ${p}, which it does not declare`).join('; ');
  return recordedReads(run, inputFilter(resolved, described, scratch, tree), tree);
}

export async function recordStep(loaded: LoadedTable, options: RecordOptions): Promise<RecordOutcome> {
  const resolved = loaded.steps.get(options.step);
  if (!resolved) throw new Error(`no step named ${options.step}`);
  const { step } = resolved;
  if (isBuild(step)) throw new Error(`${step.name} is a build step: run it with run.ts`);
  const manual = { ...resolved, step };
  const tree = pipelineTree(options.root);
  const projects = (manualDescription(step, tree)?.requestFrom ?? []).map(tree.abs);
  const held = await holdStepLocks(tree.locks, loaded, step.name, true, options.log, projects);
  try {
    const partial = options.args.length > 0;
    // Described again under the locks: the first answer only names the files to lock.
    const described = manualDescription(step, tree);
    if (!partial && !options.force && manualFreshness(step, resolved.outputs, tree, described).kind === 'fresh') return { kind: 'fresh' };
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
