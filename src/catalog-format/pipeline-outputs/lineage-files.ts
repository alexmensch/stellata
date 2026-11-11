// Where each lineage stage's files live and how they are named, as output declarations. See README.md.

export interface LineageLayout {
  readonly current: string;
  readonly previous: string;
  readonly diff: string;
}

export function lineageLayout(buildDir: string): LineageLayout {
  return { current: `${buildDir}/lineage`, previous: `${buildDir}/lineage.previous`, diff: `${buildDir}/lineage-diff` };
}

/** Repo-relative. */
export const LINEAGE_REPO_LAYOUT = lineageLayout('build');

/** A stage's files by stem: `<stem>.tsv.gz` each, one `<stage>.header.json`. */
export interface StageLineageSpec<F extends string, S extends string = string> {
  readonly stage: S;
  readonly files: readonly F[];
  /** The stem holding identity rows for the records the stage founds. */
  readonly identity?: F;
}

export const MEMBERSHIP_LINEAGE: StageLineageSpec<'membership' | 'identity', 'membership'> = {
  stage: 'membership',
  files: ['membership', 'identity'],
  identity: 'identity',
};

export const PLACEMENT_LINEAGE: StageLineageSpec<'placement', 'placement'> = {
  stage: 'placement',
  files: ['placement'],
};

export const BRIGHTNESS_COLOUR_LINEAGE: StageLineageSpec<'brightness-colour', 'brightness-colour'> = {
  stage: 'brightness-colour',
  files: ['brightness-colour'],
};

export const SIZE_LINEAGE: StageLineageSpec<'size', 'size'> = {
  stage: 'size',
  files: ['size'],
};

export const COHERENCE_LINEAGE: StageLineageSpec<'coherence', 'coherence'> = {
  stage: 'coherence',
  files: ['coherence'],
};

export const PROMOTION_LINEAGE: StageLineageSpec<'promotion' | 'promotion.identity', 'promotion'> = {
  stage: 'promotion',
  files: ['promotion', 'promotion.identity'],
  identity: 'promotion.identity',
};

/** Allocation's key -> SID file: not `identity`, which names the rows of records a stage founds. */
export const ALLOCATION_SIDS_STEM = 'allocation.sids';

export const ALLOCATION_LINEAGE: StageLineageSpec<'allocation' | typeof ALLOCATION_SIDS_STEM, 'allocation'> = {
  stage: 'allocation',
  files: ['allocation', ALLOCATION_SIDS_STEM],
};

export const NAMING_LINEAGE: StageLineageSpec<'naming', 'naming'> = {
  stage: 'naming',
  files: ['naming'],
};

/** A sibling build's allocation stage: its rows, and identity rows carrying each object's designation. */
export function siblingAllocationLineage<S extends string>(stage: S): StageLineageSpec<S | `${S}.identity`, S> {
  return { stage, files: [stage, `${stage}.identity`], identity: `${stage}.identity` };
}

export const CLOUDS_ALLOCATION_LINEAGE = siblingAllocationLineage('allocation-clouds');
export const LOCAL_GROUP_ALLOCATION_LINEAGE = siblingAllocationLineage('allocation-local-group');

/** Keyed by stage as well as stem, so two stages can share one emitArtifacts call. */
export type StageOutputKey<F extends string, S extends string = string> = `lineage:${F}` | `lineage:${S}.header`;

export const stageFileName = (stem: string): string => `${stem}.tsv.gz`;
export const stageHeaderName = (stage: string): string => `${stage}.header.json`;
export const stageDiffName = (stage: string): string => `${stage}.tsv`;

export function stageNames<F extends string>(spec: StageLineageSpec<F>): string[] {
  return [...spec.files.map(stageFileName), stageHeaderName(spec.stage)];
}

export function stageFile(dir: string, stem: string): string {
  return `${dir}/${stageFileName(stem)}`;
}

/** The stage's current files, as `declareOutputs` keys. */
export function stageOutputFiles<F extends string, S extends string>(
  layout: LineageLayout, spec: StageLineageSpec<F, S>,
): Record<StageOutputKey<F, S>, string> {
  const files = Object.fromEntries(
    spec.files.map((f) => [`lineage:${f}`, stageFile(layout.current, f)]),
  ) as Record<StageOutputKey<F, S>, string>;
  files[`lineage:${spec.stage}.header`] = `${layout.current}/${stageHeaderName(spec.stage)}`;
  return files;
}

/** The baseline copies and the stage diff, as `declareOutputs` families: emitted
 *  when they exist, deleted when a run does not emit them, and no other stage's
 *  file ever matches. */
export function stageFamilies<F extends string>(layout: LineageLayout, spec: StageLineageSpec<F>) {
  return [
    { dir: layout.previous, member: stageNames(spec), stamped: false },
    { dir: layout.diff, member: [stageDiffName(spec.stage)], stamped: false },
  ];
}
