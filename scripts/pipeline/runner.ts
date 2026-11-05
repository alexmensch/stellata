// Walks the selected steps in order: lock, check, run or skip, stamp. See README.md#the-runner--runts.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import {
  clearStamp, inputHashes, listingHashes, recordedInputs, writeStamp, type FileHashes, type RecordedReads,
} from '../util/build-stamp';
import { PIPELINE_STEP_ENV, UPDATE_SNAPSHOTS_ENV } from '../util/snapshot-check';
import { buildFreshness, manualDescription, manualFreshness, stampedOutputs } from './freshness';
import type { LoadedTable } from './step-table/load-table';
import { holdStepLocks } from './locks';
import { pipelineTree, type PipelineTree } from './pipeline-tree';
import { runRecorded, runTs } from './processes';
import { recordProblems } from './python-run-pure';
import {
  claims, isBuild, selectSteps,
  type BuildStep, type OutputClaims, type ResolvedStep, type StepGraph,
} from './step-table/step-table-pure';

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
  readonly verifyCommitted: boolean;
  readonly log: (line: string) => void;
}


const blocks = (v: Verdict): boolean => v.kind === 'stale' || v.kind === 'failed' || v.kind === 'skipped';

function rehashed(inputs: FileHashes, paths: readonly string[] | 'all', tree: PipelineTree): FileHashes {
  const keys = paths === 'all' ? Object.keys(inputs) : paths.map(tree.rel).filter((k) => k in inputs);
  return { ...inputs, ...inputHashes(keys.map(tree.abs), tree.root) };
}

class Run {
  private readonly tree: PipelineTree;
  private readonly verdicts = new Map<string, Verdict>();

  constructor(private readonly loaded: LoadedTable, private readonly options: RunOptions) {
    this.tree = pipelineTree(options.root);
  }

  private get graph(): StepGraph { return this.loaded.graph; }

  private forced(name: string): boolean {
    return this.options.force || (this.options.updateSnapshots && this.options.targets.includes(name));
  }

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
    const held = await holdStepLocks(this.tree.locks, this.loaded, step.name, isBuild(step), this.options.log);
    if (!isBuild(step)) {
      try {
        return manualFreshness(step, resolved.outputs, this.tree, manualDescription(step, this.tree));
      } catch (err) {
        return { kind: 'failed', reason: err instanceof Error ? err.message : String(err) };
      } finally {
        await held.release();
      }
    }
    try {
      const verdict = await this.build(resolved, step);
      if (held.died()) return { kind: 'failed', reason: 'its lock holder died while it ran' };
      return this.options.verifyCommitted && !blocks(verdict) ? this.verifyCommitted(step.name, resolved.outputs, verdict) : verdict;
    } catch (err) {
      return { kind: 'failed', reason: err instanceof Error ? err.message : String(err) };
    } finally {
      await held.release();
    }
  }

  private async build(resolved: ResolvedStep, step: BuildStep): Promise<Verdict> {
    const { tree } = this;
    const stampFile = tree.buildStamp(step.name);
    const judged = buildFreshness(step, resolved, tree);
    if (judged.freshness.kind === 'fresh' && !this.forced(step.name)) return judged.freshness;

    clearStamp(stampFile);
    const env: NodeJS.ProcessEnv = { ...process.env, [PIPELINE_STEP_ENV]: step.name };
    if (this.options.updateSnapshots) env[UPDATE_SNAPSHOTS_ENV] = '1';
    else delete env[UPDATE_SNAPSHOTS_ENV];
    const entry = tree.abs(step.entry);
    if (judged.language === 'ts') {
      const { inputs } = judged;
      const code = await runTs(tree, step.name, entry, [], inputs, env);
      if (code !== 0) return { kind: 'failed', reason: `exited ${code}` };
      return this.land(stampFile, resolved, rehashed(inputs, this.options.updateSnapshots ? 'all' : resolved.outputs.files, tree));
    }
    const recorded = await runRecorded(tree, step.name, entry, [], env);
    if (recorded.kind === 'exited') return { kind: 'failed', reason: `exited ${recorded.code}` };
    const { run } = recorded;
    const snapshots = judged.step.snapshots.map(tree.abs);
    const problems = recordProblems(resolved, snapshots, run, this.loaded.steps.values(), this.graph);
    if (problems.length > 0) return { kind: 'failed', reason: problems.join('; ') };
    return this.land(stampFile, resolved, rehashed(recordedInputs(tree.rekey(run.reads), tree.root), run.writes, tree), {
      listings: tree.rekey(listingHashes(run.listings, tree.root)),
      probes: tree.rekey(run.probes),
    });
  }

  private verifyCommitted(name: string, outputs: OutputClaims, verdict: Verdict): Verdict {
    const moved = movedCommittedOutputs(this.tree, outputs);
    return moved.length === 0 ? verdict : {
      kind: 'failed',
      reason: `its committed outputs differ from this build (${moved.join(', ')}): run ${rerunCommand(name)} and commit them`,
    };
  }

  private land(stampFile: string, resolved: ResolvedStep, inputs: FileHashes, recorded?: RecordedReads): Verdict {
    const missing = resolved.outputs.files.filter((p) => !existsSync(p));
    if (missing.length > 0) return { kind: 'failed', reason: `declared outputs not written: ${missing.map(this.tree.rel).join(', ')}` };
    writeStamp(stampFile, inputs, stampedOutputs(resolved.outputs), { recorded, root: this.tree.root });
    return { kind: 'built' };
  }
}

/** Repo-relative: the declared outputs git tracks whose working copy differs from the index. */
function movedCommittedOutputs(tree: PipelineTree, outputs: OutputClaims): string[] {
  const paths = [...outputs.files, ...outputs.families.map((f) => f.dir)].map(tree.rel);
  if (paths.length === 0) return [];
  const diff = execFileSync('git', ['diff', '--name-only', '-z', '--', ...paths], { cwd: tree.root, encoding: 'utf8' });
  return diff.split('\0').filter((p) => p !== '' && claims(outputs, tree.abs(p)));
}

export const rerunCommand = (name: string): string => `pnpm run ${name}`;

function describeVerdict(name: string, verdict: Verdict): string {
  switch (verdict.kind) {
    case 'fresh': return `· ${name} fresh`;
    case 'built': return `✓ ${name} built`;
    case 'stale': return `✗ ${name} stale (${verdict.changed.join(', ')}): run ${rerunCommand(name)}`;
    case 'failed': return `✗ ${name} failed: ${verdict.reason}`;
    case 'skipped': return `– ${name} skipped behind ${verdict.behind}`;
  }
}

function keptLoopLines(graph: StepGraph, tree: PipelineTree): string[] {
  return graph.keptLoops.map((e) => {
    const via = e.kind === 'reads' ? `through ${e.files.map(tree.rel).join(', ')}` : 'via an after entry';
    return `kept loop: ${e.from} → ${e.to} ${via}`;
  });
}

export async function runSteps(loaded: LoadedTable, options: RunOptions): Promise<{ verdicts: ReadonlyMap<string, Verdict>; status: number }> {
  const unknown = options.targets.filter((t) => !loaded.steps.has(t));
  if (unknown.length > 0) throw new Error(`no step named ${unknown.join(', ')}`);
  for (const line of keptLoopLines(loaded.graph, pipelineTree(options.root))) options.log(line);
  const verdicts = await new Run(loaded, options).walk();
  const status = [...verdicts.values()].some((v) => v.kind === 'stale' || v.kind === 'failed') ? 1 : 0;
  return { verdicts, status };
}
