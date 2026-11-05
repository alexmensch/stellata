// A self-written JSON file's declaration: the one serializer its writer emits through, and the row key lineage cites its records by. See README.md#a-json-artifact.

import type { Declaration, RowKey } from './row-ref-pure';

export interface JsonArtifactSpec<K> {
  /** Repo-relative. */
  readonly file: string;
  readonly hint: string;
  readonly rowKey: RowKey<K>;
}

export interface JsonArtifact<T, K> extends JsonArtifactSpec<K>, Declaration {
  readonly kind: 'artifact';
  serialize(payload: T): string;
}

export function defineJsonArtifact<T, K>(spec: JsonArtifactSpec<K>): JsonArtifact<T, K> {
  return {
    ...spec,
    kind: 'artifact',
    serialize: (payload) => `${JSON.stringify(payload)}\n`,
  } as JsonArtifact<T, K>;
}
