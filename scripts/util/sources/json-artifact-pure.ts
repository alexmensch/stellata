// A self-written JSON file's declaration: the one serializer its writer emits through, and the row key lineage cites its records by. See README.md#a-json-artifact.

import type { Declaration, RowKey } from './row-ref-pure';

export interface JsonArtifactSpec<K, I extends string = string> {
  /** Repo-relative. */
  readonly file: string;
  readonly hint: string;
  readonly rowKey: RowKey<K> & { readonly id: I };
}

export interface JsonArtifact<T, K, I extends string = string> extends JsonArtifactSpec<K, I>, Declaration {
  readonly kind: 'artifact';
  serialize(payload: T): string;
}

export function defineJsonArtifact<T, K, I extends string = string>(spec: JsonArtifactSpec<K, I>): JsonArtifact<T, K, I> {
  return {
    ...spec,
    kind: 'artifact',
    serialize: (payload) => `${JSON.stringify(payload)}\n`,
  } as JsonArtifact<T, K, I>;
}
