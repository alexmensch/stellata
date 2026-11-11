// One stage's lineage for its emitArtifacts call: render, header, baseline verdict, diff, budget. See README.md#run-to-run-diff.

import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { performance } from 'node:perf_hooks';

import type { FileHashes } from '../../util/build-stamp';
import type { ArtifactContents, Check } from '../../util/emit-artifacts';
import { headCommit, inHeadHistory, mergeBaseWithMain, onMainBranch } from '../../util/git-provenance';
import { REPO_ROOT } from '../../util/paths';
import { diffLineage, stageDiffText, tallyKeyChanges, type DiffJoin, type KeyChangeTally } from './lineage-diff-pure';
import { deletedSiblingsSince, inputHashesAt, onDiskHashes, type HashesAt } from '../../util/input-hashes-at';
import {
  ACCEPT_ANY_BASELINE_FLAG, AGAINST_FLAG, acceptedFiles, baseAt, planBaseline, type BaselineContext, type BaselineSource,
  type InputsAt,
} from './baseline/lineage-header-pure';
import { readStageHeader, stageEmission, stageProvenance, streamLineage } from './lineage-io';
import { invariantCheck, invariantViolations, type LineageInvariant } from './lineage-invariant-pure';
import { phaseClock } from './phase-clock-pure';
import { foldStageLines, sortLineageLines, type LineageLine } from './lineage-row-pure';
import type { StageCode, StageCodes } from './reason-codes/reason-codes-pure';
import {
  stageFile, stageFileName, type LineageLayout, type StageLineageSpec, type StageOutputKey,
} from '../../../src/catalog-format/pipeline-outputs/lineage-files';

/** The stage's measured cost, pinned so lineage cannot quietly grow. */
export interface LineageBudget {
  readonly gzipBytes: number;
  readonly writeMs: number;
}

export interface StageLineageRun<F extends string, S extends string> {
  readonly layout: LineageLayout;
  readonly spec: StageLineageSpec<F, S>;
  /** The step's input hashes as the runner handed them (`stepInputHashes`). */
  readonly inputs: FileHashes;
  /** The stage's own file: the one its diff reads. */
  readonly diffed: F;
  /** Each row's `stageLineageLine`, in any order; called once, inside the timed window. */
  readonly lines: () => readonly LineageLine[];
  /** Handed `lines` in lineage order. */
  readonly render: (sorted: readonly LineageLine[]) => Readonly<Record<F, string | Uint8Array>>;
  /** Built only when a diff runs, from the baseline directory it reads. */
  readonly joins: (baselineDir: string) => readonly DiffJoin[];
  readonly budget: LineageBudget;
  /** Checked over `lines`; a violation fails the emission. */
  readonly invariants: readonly LineageInvariant[];
  readonly argv: readonly string[];
  /** The stages whose `build/lineage/` files are among `inputs`. See baseline/README.md. */
  readonly upstream?: UpstreamLineage;
}

export interface StageLineageEmission<F extends string, S extends string> {
  readonly files: Record<StageOutputKey<F, S>, ArtifactContents>;
  readonly members: Map<string, ArtifactContents>;
  readonly checks: Check[];
  /** Null when no diff ran. A tally, never the lines: README.md#run-to-run-diff. */
  readonly changes: KeyChangeTally | null;
}

function baselineSource<F extends string, S extends string>(run: StageLineageRun<F, S>): BaselineSource {
  const at = run.argv.indexOf(AGAINST_FLAG);
  if (at >= 0) {
    const dir = run.argv[at + 1];
    if (dir === undefined) throw new Error(`${AGAINST_FLAG} needs a directory`);
    return { kind: 'against', dir };
  }
  if (!existsSync(stageFile(run.layout.current, run.diffed))) return { kind: 'absent' };
  return { kind: 'checkout', header: readStageHeader(run.layout.current, run.spec) };
}

export type Known =
  | { readonly kind: 'known'; readonly hashes: FileHashes }
  | { readonly kind: 'failed'; readonly reason: string };

/** Each `(commit, paths)` hashed once; a failure to hash is a refusal, never a failed build. */
export function inputsAtFrom(handed: FileHashes, known: (commit: string) => Known): InputsAt {
  const memo = new Map<string, HashesAt>();
  return (commit, paths) => {
    let key = commit;
    try {
      const listed = paths();
      key = `${commit}\0${listed.join('\0')}`;
      const held = memo.get(key);
      if (held !== undefined) return held;
      const upstream = known(commit);
      const at: HashesAt = upstream.kind === 'failed'
        ? { kind: 'unknown', reason: upstream.reason }
        : inputHashesAt(commit, onDiskHashes(listed, handed), REPO_ROOT, upstream.hashes);
      memo.set(key, at);
      return at;
    } catch (err) {
      const at: HashesAt = { kind: 'unknown', reason: `hashing them failed: ${err instanceof Error ? err.message : String(err)}` };
      memo.set(key, at);
      return at;
    }
  };
}

/** Listed on first ask, once. */
function branchPaths(mergeBase: string, inputs: readonly string[]): () => readonly string[] {
  let listed: readonly string[] | undefined;
  return () => (listed ??= [...inputs, ...deletedSiblingsSince(mergeBase, inputs)]);
}

export interface UpstreamLineage {
  /** Each upstream stage's files as `commit` holds them, by repo-relative path; hashed once per commit. */
  readonly filesAt: (commit: string) => Known;
}

export function upstreamLineage(layout: LineageLayout, specs: readonly StageLineageSpec<string>[]): UpstreamLineage {
  const memo = new Map<string, Known>();
  return {
    filesAt: (commit) => {
      let known = memo.get(commit);
      if (known === undefined) memo.set(commit, known = upstreamFiles(layout, specs, commit));
      return known;
    },
  };
}

/** From the first of each stage's headers whose inputs are `commit`'s. */
function upstreamFiles(layout: LineageLayout, specs: readonly StageLineageSpec<string>[], commit: string): Known {
  const hashes: Record<string, string> = {};
  try {
    for (const spec of specs) {
      const headers = [readStageHeader(layout.previous, spec), readStageHeader(layout.current, spec)];
      const current = headers[1];
      const read = current.kind === 'read' ? Object.keys(current.header.inputs) : [];
      const files = acceptedFiles(headers, {
        base: { kind: 'fixed', commit, paths: branchPaths(commit, read) },
        inputsAt: inputsAtFrom({}, () => ({ kind: 'known', hashes: {} })),
      });
      if (files === null) continue;
      for (const stem of spec.files) {
        hashes[relative(REPO_ROOT, stageFile(layout.current, stem))] = files[stageFileName(stem)];
      }
    }
  } catch (err) {
    return { kind: 'failed', reason: `upstream lineage: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { kind: 'known', hashes };
}

function baselineContext<F extends string, S extends string>(run: StageLineageRun<F, S>): BaselineContext | null {
  const mergeBase = mergeBaseWithMain();
  if (mergeBase === null) return null;
  return {
    base: baseAt(
      { onMainBranch: onMainBranch(), commit: headCommit() }, mergeBase, inHeadHistory,
      branchPaths(mergeBase, Object.keys(run.inputs)),
    ),
    inputsAt: inputsAtFrom(run.inputs, (commit) => run.upstream?.filesAt(commit) ?? { kind: 'known', hashes: {} }),
  };
}

export function stageLineage<F extends string, S extends string>(
  run: StageLineageRun<F, S>,
): StageLineageEmission<F, S> {
  const clock = phaseClock(() => performance.now());
  const { source, plan } = clock.lap('baseline', () => {
    const source = baselineSource(run);
    const previous = readStageHeader(run.layout.previous, run.spec);
    return { source, plan: planBaseline(previous, source, baselineContext(run), run.argv.includes(ACCEPT_ANY_BASELINE_FLAG)) };
  });
  const lines = clock.lap('lines', run.lines);
  const sorted = clock.lap('sort', () => sortLineageLines(lines));
  let changes: KeyChangeTally | null = null;
  let diff: Uint8Array | null = null;
  if (plan.kind === 'diff') {
    const dir = source.kind === 'against' ? source.dir : run.layout[plan.from === 'previous' ? 'previous' : 'current'];
    const found = clock.lap('diff', () => diffLineage(streamLineage(stageFile(dir, run.diffed)), sorted));
    changes = tallyKeyChanges(found);
    diff = clock.lap('joins and diff text', () => stageDiffText(found, run.joins(dir)));
  } else if (plan.kind === 'refused') {
    console.log(plan.message);
  } else {
    console.log(`lineage: no ${run.spec.stage} baseline in this checkout, so no diff`);
  }

  const texts = clock.lap('render', () => run.render(sorted));
  const { files, members } = clock.lap('gzip and baseline copy', () => stageEmission(
    run.layout, run.spec, texts, stageProvenance(run.spec, run.inputs), diff, plan.rotate,
  ));
  const invariantChecks = clock.lap('invariants', () => invariantViolations(run.invariants, sorted).map(invariantCheck));
  const writeMs = clock.totalMs();
  const gzipBytes = run.spec.files.reduce(
    (n, f) => n + (files[`lineage:${f}` as StageOutputKey<F, S>] as Uint8Array).byteLength, 0,
  );
  const measured = `${run.spec.stage} lineage: ${gzipBytes} bytes gzipped; header, diff, write and invariants took ${writeMs.toFixed(0)} ms (${clock.report()})`;
  const over = gzipBytes > run.budget.gzipBytes || writeMs > run.budget.writeMs;
  const checks: Check[] = [over
    ? {
      kind: 'fail',
      message: `${measured}, over its budget of ${run.budget.gzipBytes} bytes / ${run.budget.writeMs} ms`,
    }
    : { kind: 'pass', report: measured },
    ...invariantChecks];
  return { files, members, checks, changes };
}

/** stageLineage, plus the stage's count block folded from the same lines inside the timed window. See README.md#counts-fold-from-lineage. */
export function countedStageLineage<F extends string, S extends string, B extends string, L extends B>(
  run: StageLineageRun<F, S>, codes: StageCodes<B, S, L>,
): StageLineageEmission<F, S> & { readonly counts: Readonly<Record<StageCode<S, L>, number>> } {
  let counts: Record<StageCode<S, L>, number> | undefined;
  const emission = stageLineage({
    ...run,
    lines: () => {
      const lines = run.lines();
      counts = foldStageLines(codes, lines);
      return lines;
    },
  });
  if (counts === undefined) throw new Error(`lineage: ${run.spec.stage}'s lines were never produced, so nothing was counted`);
  return { ...emission, counts };
}
