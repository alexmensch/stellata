// Parser and per-record lookup for data/simbad/simbad_values.tsv — the
// bibcoded bottom tier of the § 5 value cascades. See README.md § The
// SIMBAD values index.

import { dataRows, nonEmpty, parseFloatOrNull, parseIntOrNull } from './parse/corpus-tsv';

const FILE_LABEL = 'data/simbad/simbad_values.tsv';
const REFRESH_HINT = 'Re-run `pnpm run refresh:simbad-values`.';

const COLUMNS = [
  'rvz_radvel', 'rvz_type', 'rvz_bibcode',
  'hip', 'source_id', 'tyc', 'gj',
] as const;

/** One SIMBAD row's radial velocity, with the bibcode that is its actual
 *  source. */
export interface SimbadRadialVelocity {
  kmS: number;
  bibcode: string;
}

export interface SimbadValueRow {
  rv: SimbadRadialVelocity | null;
}

/** The four namespaces the pull keyed its request on, indexed for the
 *  reverse join. A row is indexed under every id SIMBAD returned for it. */
export interface SimbadValueIndex {
  bySourceId: Map<string, SimbadValueRow>;
  byHip: Map<number, SimbadValueRow>;
  byTyc: Map<string, SimbadValueRow>;
  byGj: Map<string, SimbadValueRow>;
  /** Data rows read, counted at the walk rather than derived from the maps:
   *  the pull also enumerates by SIMBAD oid, so a row carrying none of the
   *  four ids is joinable by nothing and must still be counted. */
  rowCount: number;
}

export function emptySimbadValueIndex(): SimbadValueIndex {
  return {
    bySourceId: new Map(), byHip: new Map(), byTyc: new Map(), byGj: new Map(),
    rowCount: 0,
  };
}

/** The designation part of a spine `gl` cell or a SIMBAD `gj` id, folded to
 *  one spelling: `Gl 165A`, `GJ 165A` and `165 A` all yield `165A`. The two
 *  sides spell the same star differently — the spine carries both catalogue
 *  words and SIMBAD stores its own spacing — so both go through this before
 *  they meet. It folds strictly more than `gl_suffix` in
 *  `scripts/refresh/simbad/inputs.py`, which stripped only the catalogue word
 *  when composing the request: inner spacing and case are folded here because
 *  this is where the two spellings actually have to match. */
export function normaliseGjKey(cell: string | null): string | null {
  const text = (cell ?? '').trim();
  if (!text) return null;
  const [word, ...rest] = text.split(' ');
  const suffix = /^(gj|gl)$/i.test(word) ? rest.join(' ') : text;
  const key = suffix.replace(/\s+/g, '').toUpperCase();
  return key.length === 0 ? null : key;
}

/** SIMBAD's `rvz_radvel` is a radial velocity only where `rvz_type` reads
 *  `v`. A `z` row carries a redshift-derived quantity, which on a catalogue
 *  bounded at 50 kpc is never a stellar line-of-sight velocity — EGGR 252
 *  reads 243,879 km/s. An unbibcoded value cannot arrive (the pull drops the
 *  whole quantity at write time), so the bibcode check here guards a
 *  re-pulled file rather than this one. */
function parseRv(cells: string[], idx: Record<string, number>): SimbadRadialVelocity | null {
  if (nonEmpty(cells[idx.rvz_type]) !== 'v') return null;
  const kmS = parseFloatOrNull(cells[idx.rvz_radvel]);
  const bibcode = nonEmpty(cells[idx.rvz_bibcode]);
  if (kmS === null || bibcode === null) return null;
  return { kmS, bibcode };
}

/** Index the values pull by every identifier namespace it keyed on. No key
 *  in any namespace collides in the committed file, so a duplicate is an
 *  upstream schema change and throws rather than silently overwriting a
 *  binding the cascade would then read off the wrong star. */
export function parseSimbadValuesTsv(text: string): SimbadValueIndex {
  const index = emptySimbadValueIndex();
  for (const { cells, idx } of dataRows(text, COLUMNS, FILE_LABEL, REFRESH_HINT)) {
    const row: SimbadValueRow = { rv: parseRv(cells, idx) };
    const sourceId = nonEmpty(cells[idx.source_id]);
    const hip = parseIntOrNull(cells[idx.hip]);
    const tyc = nonEmpty(cells[idx.tyc]);
    const gj = normaliseGjKey(nonEmpty(cells[idx.gj]));
    if (sourceId !== null) put(index.bySourceId, sourceId, row, 'source_id');
    if (hip !== null) put(index.byHip, hip, row, 'hip');
    if (tyc !== null) put(index.byTyc, tyc, row, 'tyc');
    if (gj !== null) put(index.byGj, gj, row, 'gj');
    index.rowCount++;
  }
  return index;
}

function put<K>(map: Map<K, SimbadValueRow>, key: K, row: SimbadValueRow, ns: string): void {
  if (map.has(key)) {
    throw new Error(`${FILE_LABEL} has two rows keyed ${ns}=${String(key)}. ${REFRESH_HINT}`);
  }
  map.set(key, row);
}

/** The identifiers a spine record offers the join. */
export interface SimbadValueKeys {
  sourceId: string | null;
  hip: number | null;
  tyc: string | null;
  gl: string | null;
}

/** The record's SIMBAD row, resolved source_id → HIP → TYC → GJ — the same
 *  fall-through `resolve_spine_keys` composed the request with, walked in
 *  reverse. A row reached only by TYC is one the Gaia namespace could not
 *  reach; the pull already dropped the widened bindings SIMBAD's own Gaia
 *  cross-ID contradicts (`scripts/refresh/simbad/README.md` § The TYC
 *  widening carries its own veto), so what arrives here is adjudicated. */
export function lookupSimbadValues(
  index: SimbadValueIndex,
  keys: SimbadValueKeys,
): SimbadValueRow | null {
  if (keys.sourceId !== null) {
    const bySource = index.bySourceId.get(keys.sourceId);
    if (bySource !== undefined) return bySource;
  }
  if (keys.hip !== null) {
    const byHip = index.byHip.get(keys.hip);
    if (byHip !== undefined) return byHip;
  }
  if (keys.tyc !== null) {
    const byTyc = index.byTyc.get(keys.tyc);
    if (byTyc !== undefined) return byTyc;
  }
  const gj = normaliseGjKey(keys.gl);
  if (gj !== null) {
    const byGj = index.byGj.get(gj);
    if (byGj !== undefined) return byGj;
  }
  return null;
}
