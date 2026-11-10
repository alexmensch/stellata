// The SIMBAD namespace ladder both SIMBAD pulls index and join through. See README.md.

/** The namespaces every SIMBAD pull is keyed under. This order IS the record
 *  side's walk order — `walkSimbadNamespaces` iterates this array — so
 *  reordering here reorders both SIMBAD joins. Doubles as the build-counts
 *  partition over the SIMBAD tier.
 *
 *  **Ordered by what an identifier names, not by how many keys it holds.** A GJ
 *  number carries its component letter (`Gl 165A`) and so names one star; a TYC
 *  names the Tycho-2 entry, which for a close pair is the system. Where both
 *  reach a row the component-naming one wins, so a system blend never displaces
 *  a component value. This deliberately no longer mirrors the request order
 *  `WIDENING_LADDER` (`scripts/refresh/simbad/specs.py`) sets — see `../../../scripts/catalog/spectral/README.md#the-ladder-is-ordered-by-what-an-identifier-names`
 * for why the pull's order is the
 *  load-bearing one. */
export const SIMBAD_NAMESPACE_VALUES = ['source_id', 'hip', 'gj', 'tyc'] as const;
export type SimbadNamespace = (typeof SIMBAD_NAMESPACE_VALUES)[number];

/** The identifiers one record offers a SIMBAD join. `gl` is the raw Gliese
 *  cell from either side — the spine spells that column `gl` and SIMBAD `gj`
 *  — and the ladder folds it itself, so no caller handles the two
 *  spellings. */
export interface SimbadRecordKeys {
  sourceId: string | null;
  hip: number | null;
  tyc: string | null;
  gl: string | null;
}

export interface SimbadNamespaceIndex<T> {
  bySourceId: Map<string, T>;
  byHip: Map<number, T>;
  byTyc: Map<string, T>;
  byGj: Map<string, T>;
}

export function emptySimbadNamespaceIndex<T>(): SimbadNamespaceIndex<T> {
  return {
    bySourceId: new Map(), byHip: new Map(), byTyc: new Map(), byGj: new Map(),
  };
}

/** The designation part of a spine `gl` cell or a SIMBAD `gj` id, folded to
 *  one spelling: `Gl 165A`, `GJ 165A` and `165 A` all yield `165A`. The two
 *  sides spell the same star differently — the spine carries both catalogue
 *  words and SIMBAD stores its own spacing — so both go through this before
 *  they meet. It folds strictly more than `glSuffix` in
 *  `scripts/refresh/simbad/membership-keys-pure.ts`, which strips only the catalogue word
 *  when composing the request: inner spacing and case are folded here because
 *  this is where the two spellings actually have to match. */
export function normaliseGjKey(cell: string | null): string | null {
  const text = (cell ?? '').trim();
  if (!text) return null;
  const [word, ...rest] = text.split(' ');
  const suffix = /^(gj|gl)$/i.test(word) ? rest.join(' ') : text;
  const key = suffix.replace(/\s+/g, '').toUpperCase();
  // CNS5 prints whole numbers with a trailing `.0` where every other source
  // writes the bare number, so collapsing it here is what lets an index built
  // over CNS5 and a record's own `gl` cell meet. Only a ZERO fraction is the
  // artifact — the supplement's genuinely fractional entries (`Gl 17.1`) keep
  // theirs (`glieseNumber` in classic-ids/ states the same rule for the label
  // merge, where not collapsing it scored 14 same-star pairs as disagreements).
  const collapsed = key.endsWith('.0') ? key.slice(0, -2) : key;
  return collapsed.length === 0 ? null : collapsed;
}

/** Index and lookup must agree on which HIP cells are keys at all, or a row
 *  indexed under a bogus number becomes unreachable rather than absent. */
export function simbadHipKey(hip: number | null): number | null {
  return hip !== null && Number.isInteger(hip) && hip > 0 ? hip : null;
}

type SimbadNamespaceKey = string | number;

/** `Map` is invariant in its key type, so a `Map<string, T>` is not assignable
 *  to `Map<SimbadNamespaceKey, T>` even though every read and write below stays
 *  inside the concrete key type its own namespace derives. */
function keyedMap<K extends SimbadNamespaceKey, T>(
  map: Map<K, T>,
): Map<SimbadNamespaceKey, T> {
  return map as Map<SimbadNamespaceKey, T>;
}

/** Each namespace's two halves of the join: the key a record offers it, and the
 *  map that namespace's rows live in. Indexing and lookup both read this table
 *  and both iterate `SIMBAD_NAMESPACE_VALUES`, so the order there is the only
 *  statement of walk order, and a key derived for writing cannot diverge from
 *  the one derived to read it back. */
const SIMBAD_NAMESPACE_BINDINGS: {
  readonly [N in SimbadNamespace]: {
    readonly key: (keys: SimbadRecordKeys) => SimbadNamespaceKey | null;
    readonly map: <T>(index: SimbadNamespaceIndex<T>) => Map<SimbadNamespaceKey, T>;
  };
} = {
  source_id: {
    key: (keys) => keys.sourceId || null,
    map: (index) => keyedMap(index.bySourceId),
  },
  hip: {
    key: (keys) => simbadHipKey(keys.hip),
    map: (index) => keyedMap(index.byHip),
  },
  gj: {
    key: (keys) => normaliseGjKey(keys.gl),
    map: (index) => keyedMap(index.byGj),
  },
  tyc: {
    key: (keys) => keys.tyc || null,
    map: (index) => keyedMap(index.byTyc),
  },
};

/** Add one pull row under every namespace it carries; a row carrying none is
 *  joinable by nothing and indexes nowhere. */
export function indexSimbadRow<T>(
  index: SimbadNamespaceIndex<T>,
  keys: SimbadRecordKeys,
  row: T,
  /** Which of two rows sharing one key to index. No key repeats in either
   *  committed pull, so this decides nothing today; it is what a pull that
   *  did emit two rows for one key would merge through instead of failing,
   *  and the consumer that knows which cell it came for is the only thing
   *  able to order them. Returning neither — by throwing — is a valid
   *  verdict for a consumer that cannot. */
  onDuplicate: (
    namespace: SimbadNamespace,
    key: string,
    incumbent: T,
    candidate: T,
  ) => T,
): void {
  for (const namespace of SIMBAD_NAMESPACE_VALUES) {
    const binding = SIMBAD_NAMESPACE_BINDINGS[namespace];
    const key = binding.key(keys);
    if (key === null) continue;
    const map = binding.map(index);
    const incumbent = map.get(key);
    map.set(
      key,
      incumbent === undefined
        ? row
        : onDuplicate(namespace, String(key), incumbent, row),
    );
  }
}

/** Walk `SIMBAD_NAMESPACE_VALUES` in order — source_id → HIP → GJ → TYC — and
 *  return the first row `accept` takes, with the namespace that found it.
 *  `accept` returning null continues the walk, so a row that exists but carries
 *  nothing usable does not end it — which is why the spectral resolver can fall
 *  past a row whose sp_type will not parse, and record which namespace reached
 *  the row it passed over. */
export function walkSimbadNamespaces<T, R>(
  index: SimbadNamespaceIndex<T>,
  keys: SimbadRecordKeys,
  accept: (row: T, namespace: SimbadNamespace) => R | null,
): { value: R; namespace: SimbadNamespace } | null {
  for (const namespace of SIMBAD_NAMESPACE_VALUES) {
    const binding = SIMBAD_NAMESPACE_BINDINGS[namespace];
    const key = binding.key(keys);
    if (key === null) continue;
    const row = binding.map(index).get(key);
    if (row === undefined) continue;
    const value = accept(row, namespace);
    if (value !== null) return { value, namespace };
  }
  return null;
}
