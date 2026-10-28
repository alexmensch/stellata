// SourceRowRef: one row of a declared source or artifact, cited by its typed row key. See README.md#sourcerowref.

export interface RowKey<K> {
  /** Stable name of the keyed table: the `<source>` half of the text form. */
  readonly id: string;
  text(row: K): string;
}

export interface RowKeyed<K> {
  readonly file: string;
  readonly rowKey: RowKey<K>;
}

export interface SourceRowRef<K> {
  readonly source: RowKeyed<K>;
  readonly row: K;
}

export function sourceRowRef<K>(source: RowKeyed<K>, row: K): SourceRowRef<K> {
  return { source, row };
}

export function sourceRowRefText<K>(ref: SourceRowRef<K>): string {
  return `${ref.source.rowKey.id}:${ref.source.rowKey.text(ref.row)}`;
}
