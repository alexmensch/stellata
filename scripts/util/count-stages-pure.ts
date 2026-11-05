// A count snapshot nested by stage, and its flat view. See README.md (count-stages-pure.ts entry).

export interface StagedCounts<V = unknown> {
  readonly stages: Readonly<Record<string, Readonly<Record<string, V>>>>;
}

/** `flat` grouped under each key's stage: stages in `stageOf`'s order, keys in `flat`'s. */
export function nestByStage<K extends string, V>(
  flat: Readonly<Record<K, V>>,
  stageOf: Readonly<Record<K, string>>,
): StagedCounts<V> {
  const stages: Record<string, Record<string, V>> = {};
  for (const stage of Object.values<string>(stageOf)) stages[stage] ??= {};
  for (const [key, value] of Object.entries(flat) as [K, V][]) {
    const stage = stageOf[key];
    if (stage === undefined) throw new Error(`count ${key} has no stage`);
    stages[stage][key] = value;
  }
  return { stages };
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
