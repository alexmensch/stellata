// One stage's lineage for its emitArtifacts call: render, header, baseline verdict, diff, budget. See README.md#run-to-run-diff.

import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import type { FileHashes } from '../../util/build-stamp';
import type { ArtifactContents, Check } from '../../util/emit-artifacts';
import { mergeBaseWithMain } from '../../util/git-provenance';
import { diffLineage, stageDiffText, type DiffJoin, type KeyChange } from './lineage-diff-pure';
import {
  ACCEPT_ANY_BASELINE_FLAG, AGAINST_FLAG, planBaseline, type BaselineSource,
} from './lineage-header-pure';
import {
  readStageHeader, stageEmission, stageFile, stageHeader, streamLineage,
  type LineageLayout, type StageLineageSpec, type StageOutputKey,
} from './lineage-io';
import { compareLineageRows, type LineageRow } from './lineage-row-pure';

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
  readonly rows: readonly LineageRow[];
  /** Handed `rows` in lineage order. */
  readonly render: (sorted: readonly LineageRow[]) => Readonly<Record<F, string | Uint8Array>>;
  /** Built only when a diff runs, from the baseline directory it reads. */
  readonly joins: (baselineDir: string) => readonly DiffJoin[];
  readonly budget: LineageBudget;
  readonly argv: readonly string[];
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
  return { kind: 'checkout', header: readStageHeader(run.layout.current, run.spec.stage) };
}

export async function stageLineage<F extends string, S extends string>(
  run: StageLineageRun<F, S>,
): Promise<StageLineageEmission<F, S>> {
  const started = performance.now();
  const source = baselineSource(run);
  const plan = planBaseline(
    readStageHeader(run.layout.previous, run.spec.stage), source, mergeBaseWithMain(),
    run.argv.includes(ACCEPT_ANY_BASELINE_FLAG),
  );
  const { verdict } = plan;
  const sorted = [...run.rows].sort(compareLineageRows);
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

  const header = stageHeader(run.spec, run.inputs);
  const texts = run.render(sorted);
  const diff = changes === null ? null : stageDiffText(changes, joins);
  const { files, members } = stageEmission(run.layout, run.spec, texts, header, diff, plan.rotate);
  const writeMs = performance.now() - started;
  const gzipBytes = run.spec.files.reduce(
    (n, f) => n + (files[`lineage:${f}` as StageOutputKey<F, S>] as Uint8Array).byteLength, 0,
  );
  const measured = `${run.spec.stage} lineage: ${gzipBytes} bytes gzipped; header, diff and write took ${writeMs.toFixed(0)} ms`;
  const over = gzipBytes > run.budget.gzipBytes || writeMs > run.budget.writeMs;
  const checks: Check[] = [over
    ? {
      kind: 'fail',
      message: `${measured}, over its budget of ${run.budget.gzipBytes} bytes / ${run.budget.writeMs} ms`,
    }
    : { kind: 'pass', report: measured }];
  return { files, members, checks, changes };
}
