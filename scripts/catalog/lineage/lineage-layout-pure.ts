// Where a stage's lineage files live and how they are named, as output declarations. See README.md#run-to-run-diff.

import { resolve } from 'node:path';

import type { OutputFamily } from '../../util/emit-artifacts';
import { REPO_ROOT } from '../../util/paths';

export interface LineageLayout {
  readonly current: string;
  readonly previous: string;
  readonly diff: string;
}

export function lineageLayout(buildDir: string): LineageLayout {
  return {
    current: resolve(buildDir, 'lineage'),
    previous: resolve(buildDir, 'lineage.previous'),
    diff: resolve(buildDir, 'lineage-diff'),
  };
}

export const LINEAGE_LAYOUT = lineageLayout(resolve(REPO_ROOT, 'build'));

/** A stage's files by stem: `<stem>.tsv.gz` each, one `<stage>.header.json`. */
export interface StageLineageSpec<F extends string, S extends string = string> {
  readonly stage: S;
  readonly files: readonly F[];
  /** The stem holding identity rows for the records the stage founds. */
  readonly identity?: F;
}

/** Keyed by stage as well as stem, so two stages can share one emitArtifacts call. */
export type StageOutputKey<F extends string, S extends string = string> = `lineage:${F}` | `lineage:${S}.header`;

export const stageFileName = (stem: string): string => `${stem}.tsv.gz`;
export const stageHeaderName = (stage: string): string => `${stage}.header.json`;

export function stageNames<F extends string>(spec: StageLineageSpec<F>): string[] {
  return [...spec.files.map(stageFileName), stageHeaderName(spec.stage)];
}

export function stageFile(dir: string, stem: string): string {
  return resolve(dir, stageFileName(stem));
}

/** The stage's current files, as `declareOutputs` keys. */
export function stageOutputFiles<F extends string, S extends string>(
  layout: LineageLayout, spec: StageLineageSpec<F, S>,
): Record<StageOutputKey<F, S>, string> {
  const files = Object.fromEntries(
    spec.files.map((f) => [`lineage:${f}`, stageFile(layout.current, f)]),
  ) as Record<StageOutputKey<F, S>, string>;
  files[`lineage:${spec.stage}.header`] = resolve(layout.current, stageHeaderName(spec.stage));
  return files;
}

/** The baseline copies and the stage diff: emitted when they exist, deleted
 *  when a run does not emit them, and no other stage's file ever matches. */
export function stageFamilies<F extends string>(
  layout: LineageLayout, spec: StageLineageSpec<F>,
): OutputFamily[] {
  return [
    { dir: layout.previous, member: stageNames(spec), stamped: false },
    { dir: layout.diff, member: [stageDiffName(spec.stage)], stamped: false },
  ];
}

export function stageDiffName(stage: string): string {
  return `${stage}.tsv`;
}
