// SourceRowRef: one row, or one key's group of rows, of a declared source or artifact. See README.md#sourcerowref.

/** `group`: several rows of the file share one key, so a citation carries all of them. */
export type Cardinality = 'one' | 'group';

export interface RowKey<K, C extends Cardinality = 'one'> {
  /** Stable name of the keyed table: the `<source>` half of the text form. */
  readonly id: string;
  readonly cardinality: C;
  text(row: K): string;
}

/** A declaration's key: present exactly when the declaration names one. */
export type RowKeyOf<K, C extends Cardinality = 'one'> = [K] extends [never] ? undefined : RowKey<K, C>;

declare const declaration: unique symbol;

/** Carried only by `defineSource` / `defineFolder` / `defineArtifact` / `defineJsonArtifact` results:
 *  a hand-written `{file, rowKey}` cannot stand in for a declaration. */
export interface Declaration {
  readonly [declaration]: true;
}

export interface RowKeyed<K, C extends Cardinality = 'one'> extends Declaration {
  readonly file: string;
  readonly rowKey: RowKey<K, C>;
}

export interface OneRowRef<K> {
  readonly kind: 'one';
  readonly source: RowKeyed<K>;
  readonly row: K;
}

/** File lines, 1-based. */
export type GroupLines = readonly [number, ...number[]];

export interface GroupRowRef<K> {
  readonly kind: 'group';
  readonly source: RowKeyed<K, 'group'>;
  readonly key: K;
  readonly lines: GroupLines;
}

export type SourceRowRef<K> = OneRowRef<K> | GroupRowRef<K>;

/** A row of any declared source, for a list citing several. */
export type AnySourceRowRef = SourceRowRef<unknown>;

export function sourceRowRef<K>(source: RowKeyed<K>, row: K): OneRowRef<K> {
  return { kind: 'one', source, row };
}

export function groupRowRef<K>(source: RowKeyed<K, 'group'>, key: K, lines: GroupLines): GroupRowRef<K> {
  return { kind: 'group', source, key, lines };
}

/** One ref per key text, each carrying every line its key appears on, in file order. */
export function groupRowRefs<K>(
  source: RowKeyed<K, 'group'>, rows: Iterable<{ readonly key: K; readonly line: number }>,
): Map<string, GroupRowRef<K>> {
  const groups = new Map<string, { key: K; lines: [number, ...number[]] }>();
  for (const { key, line } of rows) {
    const text = source.rowKey.text(key);
    const held = groups.get(text);
    if (held === undefined) groups.set(text, { key, lines: [line] });
    else held.lines.push(line);
  }
  return new Map([...groups].map(([text, g]) => [text, groupRowRef(source, g.key, g.lines)]));
}

/** `key` holds only the key's fields: the group keeps it alive for the whole build. */
export interface LinedRow<T, K> {
  readonly row: T;
  readonly key: K;
  readonly line: number;
}

/** Each row with its key's group as `origin`, known only once every row is read. */
export function withGroupOrigins<K, T>(
  source: RowKeyed<K, 'group'>, rows: readonly LinedRow<T, K>[],
): (T & { readonly origin: GroupRowRef<K> })[] {
  const groups = groupRowRefs(source, rows);
  return rows.map(({ row, key }) => ({ ...row, origin: groups.get(source.rowKey.text(key))! }));
}

export function rowKeyText<K, C extends Cardinality>(key: RowKey<K, C>, row: K): string {
  return `${key.id}:${key.text(row)}`;
}

export function sourceRowRefText<K>(ref: SourceRowRef<K>): string {
  return ref.kind === 'one' ? rowKeyText(ref.source.rowKey, ref.row) : rowKeyText(ref.source.rowKey, ref.key);
}
