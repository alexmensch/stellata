// Walks the selected steps in order: lock, check, run or skip, stamp. See README.md#the-runner--runts.

import { existsSync } from 'node:fs';

import {
  clearStamp, fileHashes, writeStamp, type FileHashes, type RecordedReads,
} from '../util/build-stamp';
import { UPDATE_SNAPSHOTS_ENV } from '../util/snapshot-check';
import {
  derivedFreshness, manualFreshness, recordedFreshness, stampedOutputs,
  type Freshness,
} from './freshness';
import type { Loaded } from './load-table';
import { holdLocks } from './locks';
import { pipelineTree, type PipelineTree } from './pipeline-tree';
import { exec, runRecorded, TSX } from './processes';
import { recordProblems } from './python-run-pure';
import {
  isBuild, selectSteps, writersOf,
  type BuildStep, type ResolvedStep, type StepGraph,
} from './step-table-pure';

export type Verdict =
  | { readonly kind: 'fresh' }
  | { readonly kind: 'built' }
  | { readonly kind: 'stale'; readonly changed: readonly string[] }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'skipped'; readonly behind: string };

export interface RunOptions {
  readonly root: string;
  readonly targets: readonly string[];
  readonly force: boolean;
  readonly updateSnapshots: boolean;
  readonly log: (line: string) => void;
}

type Loads = Extract<Loaded, { kind: 'loaded' }>;

const blocks = (v: Verdict): boolean => v.kind === 'stale' || v.kind === 'failed' || v.kind === 'skipped';

function rehashed(inputs: FileHashes, paths: readonly string[] | 'all', tree: PipelineTree): FileHashes {
  const keys = paths === 'all' ? Object.keys(inputs) : paths.map(tree.rel).filter((k) => k in inputs);
  return { ...inputs, ...fileHashes(keys.map(tree.abs), tree.root) };
}

class Run {
  private readonly tree: PipelineTree;
  private readonly verdicts = new Map<string, Verdict>();

  constructor(private readonly loaded: Loads, private readonly options: RunOptions) {
    this.tree = pipelineTree(options.root);
  }

  private get graph(): StepGraph { return this.loaded.graph; }

  private blocker(name: string): string | null {
    const upstream = this.graph.edges.filter((e) => e.to === name).map((e) => e.from);
    return upstream.find((u) => { const v = this.verdicts.get(u); return v !== undefined && blocks(v); }) ?? null;
  }

  async walk(): Promise<ReadonlyMap<string, Verdict>> {
    for (const name of selectSteps(this.graph, this.options.targets)) {
      const behind = this.blocker(name);
      const resolved = this.loaded.steps.get(name)!;
      const verdict: Verdict = behind !== null ? { kind: 'skipped', behind } : await this.visit(resolved);
      this.verdicts.set(name, verdict);
      this.options.log(describeVerdict(name, verdict));
    }
    return this.verdicts;
  }

  private async visit(resolved: ResolvedStep): Promise<Verdict> {
    const { step } = resolved;
    const shared = writersOf(this.graph, step.name).filter((w) => isBuild(this.loaded.steps.get(w)!.step));
    const held = await holdLocks(this.tree.locks, { step: step.name, exclusive: isBuild(step), shared }, () => {
      this.options.log(`… ${step.name} waits for another run's lock`);
    });
    if (!isBuild(step)) {
      try {
        return manualFreshness(step, resolved.outputs, this.tree);
      } catch (err) {
        return { kind: 'failed', reason: err instanceof Error ? err.message : String(err) };
      } finally {
        await held.release();
      }
    }
    try {
      const verdict = await this.build(resolved, step);
      return held.died() ? { kind: 'failed', reason: 'its lock holder died while it ran' } : verdict;
    } catch (err) {
      return { kind: 'failed', reason: err instanceof Error ? err.message : String(err) };
    } finally {
      await held.release();
    }
  }

  private async build(resolved: ResolvedStep, step: BuildStep): Promise<Verdict> {
    const { tree } = this;
    const stampFile = tree.buildStamp(step.name);
    const inputs = step.language === 'ts' ? fileHashes([...resolved.reads], tree.root) : {};
    const freshness: Freshness = step.language === 'ts'
      ? derivedFreshness(stampFile, resolved.outputs, inputs, tree)
      : recordedFreshness(stampFile, resolved.outputs, tree);
    if (freshness.kind === 'fresh' && !this.options.force) return freshness;

    clearStamp(stampFile);
    const env = { ...process.env };
    if (this.options.updateSnapshots) env[UPDATE_SNAPSHOTS_ENV] = '1';
    else delete env[UPDATE_SNAPSHOTS_ENV];
    const entry = tree.abs(step.entry);
    if (step.language === 'ts') {
      const code = await exec(TSX, [entry], env);
      if (code !== 0) return { kind: 'failed', reason: `exited ${code}` };
      return this.land(stampFile, resolved, rehashed(inputs, this.options.updateSnapshots ? 'all' : resolved.outputs.files, tree));
    }
    const recorded = await runRecorded(tree, step.name, entry, [], env);
    if (recorded.kind === 'exited') return { kind: 'failed', reason: `exited ${recorded.code}` };
    const { run } = recorded;
    const snapshots = step.snapshots.map(tree.abs);
    const problems = recordProblems(resolved, snapshots, run, this.loaded.steps.values(), this.graph);
    if (problems.length > 0) return { kind: 'failed', reason: problems.join('; ') };
    return this.land(stampFile, resolved, rehashed(tree.rekey(run.reads), run.writes, tree), {
      listings: tree.rekey(run.listings),
      probes: tree.rekey(run.probes),
    });
  }

  private land(stampFile: string, resolved: ResolvedStep, inputs: FileHashes, recorded?: RecordedReads): Verdict {
    const missing = resolved.outputs.files.filter((p) => !existsSync(p));
    if (missing.length > 0) return { kind: 'failed', reason: `declared outputs not written: ${missing.map(this.tree.rel).join(', ')}` };
    writeStamp(stampFile, inputs, stampedOutputs(resolved.outputs), { recorded, root: this.tree.root });
    return { kind: 'built' };
  }
}

function describeVerdict(name: string, verdict: Verdict): string {
  switch (verdict.kind) {
    case 'fresh': return `· ${name} fresh`;
    case 'built': return `✓ ${name} built`;
    case 'stale': return `✗ ${name} stale (${verdict.changed.join(', ')}): run pnpm run ${name}`;
    case 'failed': return `✗ ${name} failed: ${verdict.reason}`;
    case 'skipped': return `– ${name} skipped behind ${verdict.behind}`;
  }
}

function keptLoopLines(graph: StepGraph, tree: PipelineTree): string[] {
  return graph.keptLoops.map((e) => `kept loop: ${e.from} → ${e.to} through ${e.files.map(tree.rel).join(', ')}`);
}

export async function runSteps(loaded: Loads, options: RunOptions): Promise<{ verdicts: ReadonlyMap<string, Verdict>; status: number }> {
  const unknown = options.targets.filter((t) => !loaded.steps.has(t));
  if (unknown.length > 0) throw new Error(`no step named ${unknown.join(', ')}`);
  for (const line of keptLoopLines(loaded.graph, pipelineTree(options.root))) options.log(line);
  const verdicts = await new Run(loaded, options).walk();
  const status = [...verdicts.values()].some((v) => v.kind === 'stale' || v.kind === 'failed') ? 1 : 0;
  return { verdicts, status };
}
