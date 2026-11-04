// One stage's lineage for its emitArtifacts call: render, header, baseline verdict, diff, budget. See README.md#run-to-run-diff.

import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { performance } from 'node:perf_hooks';

import type { FileHashes } from '../../util/build-stamp';
import type { ArtifactContents, Check } from '../../util/emit-artifacts';
import { mergeBaseWithMain } from '../../util/git-provenance';
import { REPO_ROOT } from '../../util/paths';
import { diffLineage, stageDiffText, type DiffJoin, type KeyChange } from './lineage-diff-pure';
import { inputHashesAt, type HashesAt } from '../../util/input-hashes-at';
import {
  ACCEPT_ANY_BASELINE_FLAG, AGAINST_FLAG, acceptedFiles, comparesInputs, planBaseline, type BaselineSource,
  type HeaderRead, type InputHashAt, type MergeBase,
} from './baseline/lineage-header-pure';
import { inputHashOf, readStageHeader, stageEmission, stageProvenance, streamLineage } from './lineage-io';
import { invariantCheck, invariantViolations, type LineageInvariant } from './lineage-invariant-pure';
import { sortLineageLines, type LineageLine } from './lineage-row-pure';
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
  /** The content hashes of the step's inputs (`stepInputPaths`), as the step
   *  already computed them for its stamp or its own use. */
  readonly inputs: FileHashes;
  /** The stage's own file: the one its diff reads. */
  readonly diffed: F;
  /** Each row's `stageLineageLine`, in any order. */
  readonly lines: readonly LineageLine[];
  /** Handed `lines` in lineage order. */
  readonly render: (sorted: readonly LineageLine[]) => Readonly<Record<F, string | Uint8Array>>;
  /** Built only when a diff runs, from the baseline directory it reads. */
  readonly joins: (baselineDir: string) => readonly DiffJoin[];
  readonly budget: LineageBudget;
  /** Checked over `lines`; a violation fails the emission. */
  readonly invariants: readonly LineageInvariant[];
  readonly argv: readonly string[];
  /** Every stage whose `build/lineage/` files are among `inputs`. See baseline/README.md. */
  readonly upstream?: readonly UpstreamLineage[];
}

export interface UpstreamLineage {
  readonly spec: StageLineageSpec<string>;
  /** The upstream step's own input hashes, as its header's input hash covers them. */
  readonly inputs: () => Promise<FileHashes>;
}

export interface StageLineageEmission<F extends string, S extends string> {
  readonly files: Record<StageOutputKey<F, S>, ArtifactContents>;
  readonly members: Map<string, ArtifactContents>;
  readonly checks: Check[];
  readonly changes: readonly KeyChange[] | null;
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

function inputHashAt(hashes: () => HashesAt): InputHashAt {
  try {
    const at = hashes();
    return at.kind === 'hashed' ? { kind: 'hashed', hash: inputHashOf(at.hashes) } : at;
  } catch (err) {
    return { kind: 'unknown', reason: `hashing them failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Hashed once, on first ask; a failure to hash is a refusal, never a failed build. */
export function mergeBaseAt(commit: string, hashes: () => HashesAt): MergeBase {
  let at: InputHashAt | undefined;
  return { commit, inputHash: () => (at ??= inputHashAt(hashes)) };
}

type Known = { readonly kind: 'known'; readonly hashes: FileHashes } | { readonly kind: 'failed'; readonly reason: string };

async function upstreamHashes<F extends string, S extends string>(
  run: StageLineageRun<F, S>, commit: string,
): Promise<Known> {
  const hashes: Record<string, string> = {};
  try {
    for (const up of run.upstream ?? []) {
      const inputs = await up.inputs();
      const files = acceptedFiles(
        [readStageHeader(run.layout.previous, up.spec), readStageHeader(run.layout.current, up.spec)],
        mergeBaseAt(commit, () => inputHashesAt(commit, inputs)),
      );
      if (files === null) continue;
      for (const stem of up.spec.files) {
        hashes[relative(REPO_ROOT, stageFile(run.layout.current, stem))] = files[stageFileName(stem)];
      }
    }
  } catch (err) {
    return { kind: 'failed', reason: `upstream lineage: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { kind: 'known', hashes };
}

async function mergeBase<F extends string, S extends string>(
  run: StageLineageRun<F, S>, headers: readonly HeaderRead[],
): Promise<MergeBase | null> {
  const commit = mergeBaseWithMain();
  if (commit === null) return null;
  const asked = headers.some((read) => comparesInputs(read, commit));
  const known: Known = asked ? await upstreamHashes(run, commit) : { kind: 'known', hashes: {} };
  return mergeBaseAt(commit, () => (known.kind === 'failed'
    ? { kind: 'unknown', reason: known.reason }
    : inputHashesAt(commit, run.inputs, REPO_ROOT, known.hashes)));
}

export async function stageLineage<F extends string, S extends string>(
  run: StageLineageRun<F, S>,
): Promise<StageLineageEmission<F, S>> {
  const started = performance.now();
  const source = baselineSource(run);
  const previous = readStageHeader(run.layout.previous, run.spec);
  const plan = planBaseline(
    previous, source, await mergeBase(run, source.kind === 'checkout' ? [previous, source.header] : [previous]),
    run.argv.includes(ACCEPT_ANY_BASELINE_FLAG),
  );
  const { verdict } = plan;
  const sorted = sortLineageLines(run.lines);
  let changes: KeyChange[] | null = null;
  let joins: readonly DiffJoin[] = [];
  if (plan.from !== null) {
    const dir = source.kind === 'against' ? source.dir : run.layout[plan.from === 'previous' ? 'previous' : 'current'];
    changes = diffLineage(streamLineage(stageFile(dir, run.diffed)), sorted);
    joins = run.joins(dir);
  } else if (verdict.kind === 'refused') {
    console.log(verdict.message);
  } else {
    console.log(`lineage: no ${run.spec.stage} baseline in this checkout, so no diff`);
  }

  const texts = run.render(sorted);
  const diff = changes === null ? null : stageDiffText(changes, joins);
  const { files, members } = stageEmission(
    run.layout, run.spec, texts, stageProvenance(run.spec, run.inputs), diff, plan.rotate,
  );
  const invariantChecks = invariantViolations(run.invariants, sorted).map(invariantCheck);
  const writeMs = performance.now() - started;
  const gzipBytes = run.spec.files.reduce(
    (n, f) => n + (files[`lineage:${f}` as StageOutputKey<F, S>] as Uint8Array).byteLength, 0,
  );
  const measured = `${run.spec.stage} lineage: ${gzipBytes} bytes gzipped; header, diff, write and invariants took ${writeMs.toFixed(0)} ms`;
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
