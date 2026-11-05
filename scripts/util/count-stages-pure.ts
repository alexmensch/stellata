// A count snapshot nested by stage, and its flat view. See README.md (count-stages-pure.ts entry).

export interface StagedCounts<V = unknown> {
  readonly stages: Readonly<Record<string, Readonly<Record<string, V>>>>;
}

/** Where each count of a staged snapshot is filed: the stages in pipeline order, and each key's stage. */
export interface CountStages<K extends string, S extends string> {
  readonly order: readonly S[];
  readonly of: Readonly<Record<K, S>>;
}

/** `flat` grouped under each key's stage: stages in `stages.order` (one no key reaches left out), keys in `flat`'s order. */
export function nestByStage<K extends string, S extends string, V>(
  flat: Readonly<Record<K, V>>,
  stages: CountStages<K, S>,
): StagedCounts<V> {
  const nested = new Map<string, Record<string, V>>(stages.order.map((stage) => [stage, {}]));
  for (const [key, value] of Object.entries(flat) as [K, V][]) {
    const stage = stages.of[key];
    if (stage === undefined) throw new Error(`count ${key} has no stage`);
    const counts = nested.get(stage);
    if (counts === undefined) throw new Error(`count ${key} is filed under ${stage}, which is not a declared stage`);
    counts[key] = value;
  }
  return { stages: Object.fromEntries([...nested].filter(([, counts]) => Object.keys(counts).length > 0)) };
}

export function isStaged(json: unknown): json is StagedCounts {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return false;
  const keys = Object.keys(json);
  const stages = (json as { stages?: unknown }).stages;
  return keys.length === 1 && keys[0] === 'stages'
    && stages !== null && typeof stages === 'object' && !Array.isArray(stages);
}

/** A staged snapshot with its stage level dropped; any other JSON as it is. A key two stages share throws. */
export function flattenStages(json: unknown): unknown {
  if (!isStaged(json)) return json;
  const flat: Record<string, unknown> = {};
  const owner = new Map<string, string>();
  for (const [stage, counts] of Object.entries(json.stages)) {
    for (const [key, value] of Object.entries(counts)) {
      const first = owner.get(key);
      if (first !== undefined) throw new Error(`count ${key} is under two stages, ${first} and ${stage}`);
      owner.set(key, stage);
      flat[key] = value;
    }
  }
  return flat;
}
