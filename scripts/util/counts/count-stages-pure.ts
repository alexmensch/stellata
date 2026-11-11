// A count snapshot nested by stage, and its flat view. See README.md (count-stages-pure.ts entry).

/** What a stage whose input is missing holds in the snapshot, in place of its counts. */
export const ABSENT_STAGE = 'absent';

export type StageEntry<V> = Readonly<Record<string, V>> | typeof ABSENT_STAGE;

export interface StagedCounts<V = unknown> {
  readonly stages: Readonly<Record<string, StageEntry<V>>>;
}

/** A stage's own counts, or the state that its input is missing: never zeros standing in for it. */
export type CountBlock<K extends string> =
  | { readonly kind: 'counted'; readonly counts: Readonly<Record<K, number>> }
  | { readonly kind: 'absent' };

/** The counts with no per-row decision of a stage, filed as a stage of their own beside it. */
export type DerivedStage<S extends string> = `${S}-derived`;

export function derivedStage<S extends string>(stage: S): DerivedStage<S> {
  return `${stage}-derived`;
}

export interface StageBlock<S extends string> {
  readonly stage: S | DerivedStage<S>;
  readonly block: CountBlock<string>;
}

/** Where each flat count of a staged snapshot is filed: the stages in pipeline order, and each key's stage. */
export interface CountStages<K extends string, S extends string> {
  readonly order: readonly S[];
  readonly of: Readonly<Record<K, S>>;
}

/** see README.md#the-staged-snapshot */
export function nestByStage<K extends string, S extends string, V>(
  flat: Readonly<Record<K, V>>,
  stages: CountStages<K, S>,
  blocks: readonly StageBlock<S>[] = [],
): StagedCounts<V | number> {
  const nested = new Map<string, Record<string, V | number> | typeof ABSENT_STAGE>(
    stages.order.flatMap((stage) => [[stage, {}], [derivedStage(stage), {}]]),
  );
  const composed = new Set<string>();
  for (const { stage, block } of blocks) {
    if (!nested.has(stage)) throw new Error(`count block ${stage} is not a declared stage`);
    if (composed.has(stage)) throw new Error(`count block ${stage} is composed twice`);
    composed.add(stage);
    nested.set(stage, block.kind === 'absent' ? ABSENT_STAGE : { ...block.counts });
  }
  for (const [key, value] of Object.entries(flat) as [K, V][]) {
    const stage = stages.of[key];
    if (stage === undefined) throw new Error(`count ${key} has no stage`);
    const counts = nested.get(stage);
    if (counts === undefined) throw new Error(`count ${key} is filed under ${stage}, which is not a declared stage`);
    if (composed.has(stage)) throw new Error(`count ${key} is filed under ${stage}, which a count block composes`);
    (counts as Record<string, V>)[key] = value;
  }
  return {
    stages: Object.fromEntries([...nested].filter(([, counts]) => counts === ABSENT_STAGE || Object.keys(counts).length > 0)),
  };
}

export function isStaged(json: unknown): json is StagedCounts {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return false;
  const keys = Object.keys(json);
  const stages = (json as { stages?: unknown }).stages;
  return keys.length === 1 && keys[0] === 'stages'
    && stages !== null && typeof stages === 'object' && !Array.isArray(stages);
}

function countedStages(json: StagedCounts): [string, Readonly<Record<string, unknown>>][] {
  return Object.entries(json.stages).filter((e): e is [string, Readonly<Record<string, unknown>>] => e[1] !== ABSENT_STAGE);
}

/** Each count's stage in a staged snapshot; null for any other JSON. */
export function stageOfCounts(json: unknown): ReadonlyMap<string, string> | null {
  if (!isStaged(json)) return null;
  return new Map(countedStages(json).flatMap(([stage, counts]) => Object.keys(counts).map((key) => [key, stage])));
}

/** The stages a staged snapshot records as absent; empty for any other JSON. */
export function absentStages(json: unknown): ReadonlySet<string> {
  if (!isStaged(json)) return new Set();
  return new Set(Object.entries(json.stages).filter(([, counts]) => counts === ABSENT_STAGE).map(([stage]) => stage));
}

/** see README.md#the-staged-snapshot */
export function flattenStages(json: unknown): unknown {
  if (!isStaged(json)) return json;
  const flat: Record<string, unknown> = {};
  const owner = new Map<string, string>();
  for (const [stage, counts] of countedStages(json)) {
    for (const [key, value] of Object.entries(counts)) {
      const first = owner.get(key);
      if (first !== undefined) throw new Error(`count ${key} is under two stages, ${first} and ${stage}`);
      owner.set(key, stage);
      flat[key] = value;
    }
  }
  return flat;
}
